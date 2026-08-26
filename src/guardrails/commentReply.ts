import {
  LOOP_REPLY_MARKER,
  MAX_REPLY_BLOCKS,
  REVIEW_THREAD_FETCH_COMMAND,
  REVIEW_WORK_PUSH_COMMAND,
  THREADED_REPLY_TARGET,
} from "./constants.js";
import {
  CommentReplyGateAction,
  type CommentReplyGateDecision,
  type GuardrailState,
  type HookInput,
} from "./types.js";

// muggle-do's address-reviews round ends with one threaded reply per comment it
// acted on (do/per-comment-replies.md). Skipping that step is invisible from
// the diff — the code lands, the reviewer sees no answer in the thread, and the
// watcher re-dispatches the same thread on the next tick because the loop
// marker that would have retired it was never posted.
const REPLY_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_REPLY_SKIP\b/;

/** One unresolved thread as either provider renders it: GitHub nests comments under `comments.nodes`, GitLab keeps notes flat under `notes`. */
interface UnresolvedThread {
  id?: string;
  isResolved?: boolean;
  comments?: { nodes?: ThreadComment[] };
  notes?: ThreadComment[];
}

interface ThreadComment {
  databaseId?: number;
  body?: string;
  resolved?: boolean;
  createdAt?: string;
  created_at?: string;
}

function parsedResponse(input: HookInput): unknown {
  for (const rendered of [input.tool_response?.stdout, input.tool_response?.output]) {
    if (!rendered) continue;
    try {
      return JSON.parse(rendered);
    } catch {
      continue;
    }
  }
  return undefined;
}

// Both providers wrap their threads differently — GitHub buries them under
// data.repository.pullRequest.reviewThreads.nodes, GitLab returns a bare array —
// and a jq filter in the recipe can reshape either. Recognising a thread by the
// comment list it carries rather than by its path keeps the detector working
// through whatever envelope the round's command produced.
function collectThreads(value: unknown, found: UnresolvedThread[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectThreads(entry, found));
    return;
  }
  if (!value || typeof value !== "object") return;
  const thread = value as UnresolvedThread;
  if (Array.isArray(thread.comments?.nodes) || Array.isArray(thread.notes)) {
    found.push(thread);
    return;
  }
  Object.values(value).forEach((nested) => collectThreads(nested, found));
}

// The recipes classify by the thread's newest comment, so ordering is
// load-bearing. Both APIs return ascending already; sorting when every entry
// carries a timestamp keeps a jq reshuffle in the round's own command from
// inverting the verdict.
function newestComment(comments: ThreadComment[]): ThreadComment | undefined {
  const timestampOf = (comment: ThreadComment): string | undefined =>
    comment.createdAt ?? comment.created_at;
  if (comments.every((comment) => timestampOf(comment) !== undefined)) {
    return [...comments].sort((earlier, later) =>
      (timestampOf(earlier) ?? "").localeCompare(timestampOf(later) ?? ""),
    )[comments.length - 1];
  }
  return comments[comments.length - 1];
}

function unansweredIdOf(thread: UnresolvedThread): string | undefined {
  if (thread.isResolved === true) return undefined;
  const githubComments = thread.comments?.nodes;
  if (Array.isArray(githubComments)) {
    const newest = newestComment(githubComments);
    if (!newest || (newest.body ?? "").includes(LOOP_REPLY_MARKER)) return undefined;
    return newest.databaseId === undefined ? undefined : String(newest.databaseId);
  }
  const notes = thread.notes ?? [];
  // A GitLab discussion is unresolved only while some note says so; the MR
  // description and system notes carry no resolved field at all and must not be
  // mistaken for threads awaiting an answer.
  if (!notes.some((note) => note.resolved === false)) return undefined;
  const newest = newestComment(notes);
  if (!newest || (newest.body ?? "").includes(LOOP_REPLY_MARKER)) return undefined;
  return thread.id;
}

/**
 * The review comments this fetch shows still waiting on an answer.
 *
 * Reads the unresolved-thread fetch the round works from and keeps the threads
 * whose newest comment lacks the loop marker — the rule the unresolved-thread
 * recipes under `_shared/vcs` classify by, so the gate and the round share one
 * definition of a thread that still owes a reply. Keyed on GitHub by the newest
 * comment's `databaseId` and on GitLab by the discussion id, which is what each
 * provider's threaded-reply call targets.
 *
 * Output shape: `["2101993355", "a1b2c3d4"]`
 */
export function detectUnansweredCommentIds(input: HookInput): string[] {
  if (input.tool_name !== "Bash") return [];
  if (!REVIEW_THREAD_FETCH_COMMAND.test(input.tool_input?.command ?? "")) return [];
  const threads: UnresolvedThread[] = [];
  collectThreads(parsedResponse(input), threads);
  const unanswered = threads.map(unansweredIdOf).filter((id): id is string => id !== undefined);
  return [...new Set(unanswered)];
}

/** The comment ids this call posted a threaded reply to, on either provider. */
export function detectRepliedCommentIds(input: HookInput): string[] {
  if (input.tool_name !== "Bash") return [];
  const command = input.tool_input?.command ?? "";
  return [...command.matchAll(THREADED_REPLY_TARGET)].map(
    ([, githubCommentId, gitlabDiscussionId]) => githubCommentId ?? gitlabDiscussionId,
  );
}

/** Whether a Bash command pushed the change that acts on the reviews — the signal that turns owed replies into overdue ones. */
export function isReviewWorkPush(command: string): boolean {
  return REVIEW_WORK_PUSH_COMMAND.test(command);
}

/** Record threads awaiting a reply, returning the same reference when nothing changed so the caller can skip a redundant write. */
export function applyUnansweredComments(
  state: GuardrailState,
  commentIds: string[],
): GuardrailState {
  const owed = [...(state.commentRepliesOwed ?? [])];
  for (const commentId of commentIds) if (!owed.includes(commentId)) owed.push(commentId);
  if (owed.length === (state.commentRepliesOwed ?? []).length) return state;
  return { ...state, commentRepliesOwed: owed };
}

/** Record threaded replies, returning the same reference when nothing changed so the caller can skip a redundant write. */
export function applyPostedReplies(state: GuardrailState, commentIds: string[]): GuardrailState {
  const posted = [...(state.commentRepliesPosted ?? [])];
  for (const commentId of commentIds) if (!posted.includes(commentId)) posted.push(commentId);
  if (posted.length === (state.commentRepliesPosted ?? []).length) return state;
  return { ...state, commentRepliesPosted: posted };
}

/** Record that the round pushed its change, returning the same reference when it was already recorded. */
export function applyReviewWorkPush(state: GuardrailState, pushed: boolean): GuardrailState {
  if (!pushed || state.reviewWorkPushed === true) return state;
  return { ...state, reviewWorkPushed: true };
}

/** Whether a Bash command is the explicit comment-reply skip declaration. */
export function isReplySkipMarker(command: string): boolean {
  return REPLY_SKIP_MARKER.test(command);
}

/**
 * Apply a `MUGGLE_REPLY_SKIP: <commentId> <reason>` declaration.
 *
 * The marker clears the comments it names — the escalation path, where a round
 * defers a thread to the user instead of answering it, leaves exactly those
 * threads owed. When it names none it degrades to a session-wide skip, so a
 * round that never saw a usable comment id still has a way out.
 */
export function applyReplySkip(state: GuardrailState, command: string): GuardrailState {
  if (!isReplySkipMarker(command)) return state;
  const namedComments = (state.commentRepliesOwed ?? []).filter((commentId) =>
    command.includes(commentId),
  );
  if (namedComments.length > 0) return applyPostedReplies(state, namedComments);
  if (state.commentReplySkipped === true) return state;
  return { ...state, commentReplySkipped: true };
}

/** The review comments with no threaded reply yet. */
export function unansweredComments(state: GuardrailState): string[] {
  const posted = new Set(state.commentRepliesPosted ?? []);
  return (state.commentRepliesOwed ?? []).filter((commentId) => !posted.has(commentId));
}

/**
 * Decide what the Stop hook does about review comments the round acted on but never answered.
 *
 * - `None`    — nothing owed, every thread answered, no push happened (reading
 *               reviews is not acting on them), or a skip recorded.
 * - `Block`   — the change was pushed and a thread it addressed carries no
 *               reply; hold the turn open.
 * - `Release` — blocked `maxBlocks` times already, so a thread that genuinely
 *               cannot be answered can't trap the session.
 */
export function commentReplyGateDecision(
  state: GuardrailState,
  maxBlocks: number = MAX_REPLY_BLOCKS,
): CommentReplyGateDecision {
  const blockCount = state.commentReplyBlockCount ?? 0;
  const unanswered = unansweredComments(state);
  const settled =
    state.commentReplySkipped === true || state.reviewWorkPushed !== true || unanswered.length === 0;
  if (settled) {
    return { action: CommentReplyGateAction.None, blockCount: blockCount, unanswered: unanswered };
  }
  if (blockCount >= maxBlocks) {
    return {
      action: CommentReplyGateAction.Release,
      blockCount: blockCount,
      unanswered: unanswered,
    };
  }
  return {
    action: CommentReplyGateAction.Block,
    blockCount: blockCount + 1,
    unanswered: unanswered,
  };
}
