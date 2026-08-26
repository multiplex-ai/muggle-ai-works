import { existsSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  LOOP_REPLY_MARKER,
  MAX_REPLY_BLOCKS,
  REVIEW_THREAD_FETCH_COMMAND,
  THREADED_REPLY_TARGET,
} from "./constants.js";
import { readLedger } from "./ledger/store.js";
import { threadState, uncoveredComments } from "./ledger/obligations.js";
import { LedgerProvider, ThreadState, type Ledger } from "./ledger/types.js";
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

// The short revision a loop reply cites, which records which push addressed the
// thread. Read back from the created comment so the ledger stores what actually
// shipped rather than what the round intended to say.
const REPLY_SHA_CITATION = /Addressed in ([0-9a-f]{7,40})/;

/** One unresolved thread as either provider renders it: GitHub nests comments under `comments.nodes`, GitLab keeps notes flat under `notes`. */
interface UnresolvedThread {
  id?: string;
  isResolved?: boolean;
  comments?: { nodes?: ThreadComment[] };
  notes?: ThreadComment[];
}

interface ThreadComment {
  databaseId?: number;
  id?: number | string;
  body?: string;
  resolved?: boolean;
  createdAt?: string;
  created_at?: string;
}

/** A thread the round pulled in, with the comments in it still awaiting an answer. */
export interface UnansweredThread {
  threadId: string;
  provider: LedgerProvider;
  humanCommentIds: string[];
}

/** A threaded reply the provider confirmed, and the revision its body cites. */
export interface ConfirmedReply {
  targetId: string;
  replySha: string | null;
}

/** A thread the running session took and left unanswered, with the comments still owed a reply. */
export interface OverdueThread {
  threadId: string;
  uncovered: string[];
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

const commentTimestamp = (comment: ThreadComment): string =>
  comment.createdAt ?? comment.created_at ?? "";

// The recipes classify in createdAt order, so ordering is load-bearing. Both
// APIs return ascending already; sorting when every entry carries a timestamp
// keeps a jq reshuffle in the round's own command from inverting the verdict.
function inChronologicalOrder(comments: ThreadComment[]): ThreadComment[] {
  if (comments.some((comment) => commentTimestamp(comment) === "")) return comments;
  return [...comments].sort((earlier, later) =>
    commentTimestamp(earlier).localeCompare(commentTimestamp(later)),
  );
}

const isLoopAuthored = (comment: ThreadComment): boolean =>
  (comment.body ?? "").includes(LOOP_REPLY_MARKER);

/**
 * The comments in a thread that post-date its newest loop reply.
 *
 * Anything older was already answered — by this loop in an earlier round, or
 * before the ledger existed at all — so counting it would resurrect obligations
 * that were met. This is the same rule the unresolved-thread recipes classify by.
 */
function commentsAwaitingReply(comments: ThreadComment[]): ThreadComment[] {
  const ordered = inChronologicalOrder(comments);
  let lastLoopIndex = -1;
  ordered.forEach((comment, index) => {
    if (isLoopAuthored(comment)) lastLoopIndex = index;
  });
  return ordered.slice(lastLoopIndex + 1).filter((comment) => !isLoopAuthored(comment));
}

function githubThread(thread: UnresolvedThread): UnansweredThread | undefined {
  if (thread.isResolved === true || !thread.id) return undefined;
  const awaiting = commentsAwaitingReply(thread.comments?.nodes ?? []);
  const humanCommentIds = awaiting
    .map((comment) => comment.databaseId)
    .filter((databaseId): databaseId is number => databaseId !== undefined)
    .map(String);
  if (humanCommentIds.length === 0) return undefined;
  return {
    threadId: thread.id,
    provider: LedgerProvider.GitHub,
    humanCommentIds: humanCommentIds,
  };
}

function gitlabThread(thread: UnresolvedThread): UnansweredThread | undefined {
  const notes = thread.notes ?? [];
  // A GitLab discussion is unresolved only while some note says so; the MR
  // description and system notes carry no resolved field at all and must not be
  // mistaken for threads awaiting an answer.
  if (!notes.some((note) => note.resolved === false) || !thread.id) return undefined;
  const humanCommentIds = commentsAwaitingReply(notes)
    .map((note) => note.id)
    .filter((noteId): noteId is number | string => noteId !== undefined)
    .map(String);
  if (humanCommentIds.length === 0) return undefined;
  return {
    threadId: thread.id,
    provider: LedgerProvider.GitLab,
    humanCommentIds: humanCommentIds,
  };
}

/**
 * The threads this fetch shows still waiting on an answer, with the comments in each.
 *
 * Keyed on the thread rather than a single comment: the thread is the unit both
 * providers resolve, and it is what the reply endpoint threads under. Each
 * thread carries every comment that post-dates its newest loop reply, so three
 * consecutive questions are three obligations rather than one.
 *
 * Output shape: `[{ threadId: "PRRT_1", provider: "github", humanCommentIds: ["11", "12"] }]`
 */
export function detectUnansweredThreads(input: HookInput): UnansweredThread[] {
  if (input.tool_name !== "Bash") return [];
  if (!REVIEW_THREAD_FETCH_COMMAND.test(input.tool_input?.command ?? "")) return [];
  const threads: UnresolvedThread[] = [];
  collectThreads(parsedResponse(input), threads);
  return threads
    .map((thread) => (Array.isArray(thread.notes) ? gitlabThread(thread) : githubThread(thread)))
    .filter((thread): thread is UnansweredThread => thread !== undefined);
}

/**
 * The threaded replies this call posted and the provider confirmed.
 *
 * Confirmation is the created comment id in the response, never the request:
 * `per-comment-replies.md` expects individual replies to fail and logs them, so
 * recording from the command alone would close an obligation the provider
 * rejected. `targetId` is a comment id on GitHub and a discussion id on GitLab —
 * whichever the reply call addressed.
 */
export function detectConfirmedReplies(input: HookInput): ConfirmedReply[] {
  if (input.tool_name !== "Bash") return [];
  const command = input.tool_input?.command ?? "";
  const targets = [...command.matchAll(THREADED_REPLY_TARGET)].map(
    ([, githubCommentId, gitlabDiscussionId]) => githubCommentId ?? gitlabDiscussionId,
  );
  if (targets.length === 0) return [];
  const created = parsedResponse(input) as { id?: number | string; body?: string } | undefined;
  if (created?.id === undefined) return [];
  const replySha = REPLY_SHA_CITATION.exec(created.body ?? "")?.[1] ?? null;
  return targets.map((targetId) => ({ targetId: targetId, replySha: replySha }));
}

/** Whether a Bash command is the explicit comment-reply skip declaration. */
export function isReplySkipMarker(command: string): boolean {
  return REPLY_SKIP_MARKER.test(command);
}

/**
 * The thread a confirmed reply belongs to.
 *
 * GitLab addresses the discussion directly, so its target already is the thread
 * id. GitHub addresses one comment inside the thread, so the ledger's own
 * comment lists are what map it back.
 */
export function threadForReplyTarget(ledger: Ledger, targetId: string): string | undefined {
  if (ledger.threads[targetId]) return targetId;
  for (const [threadId, entry] of Object.entries(ledger.threads)) {
    if (entry.humanCommentIds.includes(targetId)) return threadId;
  }
  return undefined;
}

/** The muggle-do slot tracking a PR, found by joining on the url the slot records. */
export function resolveSlotForPr(prUrl: string, sessionsDirOverride?: string): string | undefined {
  const sessionsDir = sessionsDirOverride ?? join(homedir(), ".muggle-ai", "muggle-do", "sessions");
  if (!existsSync(sessionsDir)) return undefined;
  for (const slug of readdirSync(sessionsDir)) {
    const slotPath = join(sessionsDir, slug);
    try {
      const parsed = JSON.parse(readFileSync(join(slotPath, "prs.json"), "utf-8")) as unknown;
      const slotPr = Array.isArray(parsed) ? parsed[0] : parsed;
      if ((slotPr as { url?: string } | undefined)?.url === prUrl) return slotPath;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * The threads this session claimed that are still unprocessed.
 *
 * Scoped to the running session's own claims: another session's unfinished
 * obligation is re-claimed by the next round that reads it, and must never hold
 * a turn open in a session that has no context for it.
 */
export function overdueThreads(slotPath: string, sessionId: string): OverdueThread[] {
  const overdue: OverdueThread[] = [];
  for (const [threadId, entry] of Object.entries(readLedger(slotPath).threads)) {
    if (entry.lastClaimedBySessionId !== sessionId) continue;
    if (threadState(entry) === ThreadState.Processed) continue;
    overdue.push({ threadId: threadId, uncovered: uncoveredComments(entry) });
  }
  return overdue;
}

/**
 * Decide what the Stop hook does about review comments the round took and never answered.
 *
 * - `None`    — nothing overdue, or a skip recorded.
 * - `Block`   — a thread this session claimed carries no reply; hold the turn open.
 * - `Release` — blocked `maxBlocks` times already, so a thread that genuinely
 *               cannot be answered can't trap the session.
 */
export function commentReplyGateDecision(
  state: GuardrailState,
  overdue: OverdueThread[],
  maxBlocks: number = MAX_REPLY_BLOCKS,
): CommentReplyGateDecision {
  const blockCount = state.commentReplyBlockCount ?? 0;
  const unanswered = overdue.flatMap((thread) => thread.uncovered);
  if (state.commentReplySkipped === true || unanswered.length === 0) {
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

/** A thread and the comments in it a deferral marker named. */
export interface DeferredThread {
  threadId: string;
  commentIds: string[];
}

/**
 * The ledger comments a `MUGGLE_REPLY_SKIP` declaration names, grouped by thread.
 *
 * Only comments the ledger already tracks count, so a typo cannot silently
 * settle an obligation that was never recorded.
 */
export function deferredCommentIds(ledger: Ledger, command: string): DeferredThread[] {
  const deferred: DeferredThread[] = [];
  for (const [threadId, entry] of Object.entries(ledger.threads)) {
    const named = uncoveredComments(entry).filter((commentId) => command.includes(commentId));
    if (named.length > 0) deferred.push({ threadId: threadId, commentIds: named });
  }
  return deferred;
}
