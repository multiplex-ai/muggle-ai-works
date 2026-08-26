import { describe, it, expect } from "vitest";
import {
  applyPostedReplies,
  applyReplySkip,
  applyReviewWorkPush,
  applyUnansweredComments,
  commentReplyGateDecision,
  detectRepliedCommentIds,
  detectUnansweredCommentIds,
  isReplySkipMarker,
  isReviewWorkPush,
  unansweredComments,
} from "../../guardrails/commentReply.js";
import { LOOP_REPLY_MARKER, MAX_REPLY_BLOCKS } from "../../guardrails/constants.js";
import { CommentReplyGateAction, type GuardrailState } from "../../guardrails/types.js";

const baseState = (): GuardrailState => ({ sessionId: "s", prsHandled: [] });

const THREAD_QUERY = "gh api graphql -f query='{ reviewThreads(first: 100) { nodes { id } } }'";
const DISCUSSIONS_QUERY = "glab api projects/:id/merge_requests/12/discussions --paginate";

const githubComment = (databaseId: number, body: string, createdAt: string) => ({
  databaseId: databaseId,
  body: body,
  createdAt: createdAt,
});

const githubThreadsResponse = (
  threads: Array<{ isResolved: boolean; comments: ReturnType<typeof githubComment>[] }>,
): string =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: threads.map((thread) => ({
              id: "PRRT_1",
              isResolved: thread.isResolved,
              comments: { nodes: thread.comments },
            })),
          },
        },
      },
    },
  });

const fetchInput = (command: string, stdout: string) => ({
  tool_name: "Bash",
  tool_input: { command: command },
  tool_response: { stdout: stdout },
});

describe("detectUnansweredCommentIds", () => {
  it("records a thread whose newest comment is human", () => {
    const stdout = githubThreadsResponse([
      { isResolved: false, comments: [githubComment(11, "this leaks a handle", "2026-08-01T00:00:00Z")] },
    ]);
    expect(detectUnansweredCommentIds(fetchInput(THREAD_QUERY, stdout))).toEqual(["11"]);
  });

  // The loop marker, not the author login, is the addressed signal: under a
  // shared account the loop posts as the change author.
  it("ignores a thread the loop already replied to", () => {
    const stdout = githubThreadsResponse([
      {
        isResolved: false,
        comments: [
          githubComment(11, "this leaks a handle", "2026-08-01T00:00:00Z"),
          githubComment(12, `${LOOP_REPLY_MARKER}\nAddressed in a1b2c3d.`, "2026-08-01T01:00:00Z"),
        ],
      },
    ]);
    expect(detectUnansweredCommentIds(fetchInput(THREAD_QUERY, stdout))).toEqual([]);
  });

  it("records a human follow-up that post-dates the loop reply", () => {
    const stdout = githubThreadsResponse([
      {
        isResolved: false,
        comments: [
          githubComment(11, "this leaks a handle", "2026-08-01T00:00:00Z"),
          githubComment(12, `${LOOP_REPLY_MARKER}\nAddressed in a1b2c3d.`, "2026-08-01T01:00:00Z"),
          githubComment(13, "still leaks on the error path", "2026-08-01T02:00:00Z"),
        ],
      },
    ]);
    expect(detectUnansweredCommentIds(fetchInput(THREAD_QUERY, stdout))).toEqual(["13"]);
  });

  it("ignores a resolved thread", () => {
    const stdout = githubThreadsResponse([
      { isResolved: true, comments: [githubComment(11, "nit", "2026-08-01T00:00:00Z")] },
    ]);
    expect(detectUnansweredCommentIds(fetchInput(THREAD_QUERY, stdout))).toEqual([]);
  });

  // Ordering is the whole classification, and a jq reshuffle in the round's own
  // command must not invert it.
  it("classifies by the newest comment even when the response is out of order", () => {
    const stdout = githubThreadsResponse([
      {
        isResolved: false,
        comments: [
          githubComment(12, `${LOOP_REPLY_MARKER}\nAddressed in a1b2c3d.`, "2026-08-01T01:00:00Z"),
          githubComment(11, "this leaks a handle", "2026-08-01T00:00:00Z"),
        ],
      },
    ]);
    expect(detectUnansweredCommentIds(fetchInput(THREAD_QUERY, stdout))).toEqual([]);
  });

  it("records an unresolved gitlab discussion by its discussion id", () => {
    const stdout = JSON.stringify([
      {
        id: "a1b2c3d4",
        notes: [{ body: "this leaks a handle", resolved: false, created_at: "2026-08-01T00:00:00Z" }],
      },
    ]);
    expect(detectUnansweredCommentIds(fetchInput(DISCUSSIONS_QUERY, stdout))).toEqual(["a1b2c3d4"]);
  });

  it("ignores a gitlab thread whose notes are all resolved", () => {
    const stdout = JSON.stringify([
      {
        id: "a1b2c3d4",
        notes: [{ body: "this leaks a handle", resolved: true, created_at: "2026-08-01T00:00:00Z" }],
      },
    ]);
    expect(detectUnansweredCommentIds(fetchInput(DISCUSSIONS_QUERY, stdout))).toEqual([]);
  });

  it("ignores a command that is not a thread fetch", () => {
    const stdout = githubThreadsResponse([
      { isResolved: false, comments: [githubComment(11, "nit", "2026-08-01T00:00:00Z")] },
    ]);
    expect(detectUnansweredCommentIds(fetchInput("git log --oneline -5", stdout))).toEqual([]);
  });

  it("degrades to nothing owed when the response is not JSON", () => {
    expect(detectUnansweredCommentIds(fetchInput(THREAD_QUERY, "gh: not found"))).toEqual([]);
  });
});

describe("detectRepliedCommentIds", () => {
  it("reads the github threaded-reply target out of the command", () => {
    expect(
      detectRepliedCommentIds({
        tool_name: "Bash",
        tool_input: {
          command:
            "gh api --method POST repos/o/r/pulls/7/comments/11/replies -f body=\"$body\"",
        },
      }),
    ).toEqual(["11"]);
  });

  it("reads the gitlab discussion note target out of the command", () => {
    expect(
      detectRepliedCommentIds({
        tool_name: "Bash",
        tool_input: {
          command:
            "glab api --method POST projects/:id/merge_requests/12/discussions/a1b2c3d4/notes -f body=x",
        },
      }),
    ).toEqual(["a1b2c3d4"]);
  });

  it("ignores a command that posts no threaded reply", () => {
    expect(
      detectRepliedCommentIds({
        tool_name: "Bash",
        tool_input: { command: "gh pr comment 7 --body 'resolve when you can'" },
      }),
    ).toEqual([]);
  });
});

describe("isReviewWorkPush", () => {
  it.each([
    ["a plain push", "git push origin users/stan4/fix"],
    ["a push through a worktree flag", "git -C /repo push --force-with-lease"],
    ["the remote signed-commit path", "gh api graphql -f query='mutation { createCommitOnBranch(...) }'"],
  ])("counts %s as acting on the reviews", (_label, command) => {
    expect(isReviewWorkPush(command)).toBe(true);
  });

  it("does not count a read-only command", () => {
    expect(isReviewWorkPush("git status --porcelain")).toBe(false);
  });
});

describe("commentReplyGateDecision", () => {
  const pushedWithOwed = (): GuardrailState =>
    applyReviewWorkPush(applyUnansweredComments(baseState(), ["11", "13"]), true);

  it("blocks when a pushed round left a comment unanswered", () => {
    const decision = commentReplyGateDecision(pushedWithOwed());
    expect(decision.action).toBe(CommentReplyGateAction.Block);
    expect(decision.unanswered).toEqual(["11", "13"]);
    expect(decision.blockCount).toBe(1);
  });

  // Reading reviews is not acting on them: an ambiguous-only round escalates to
  // the user and pushes nothing, and must still be able to end its turn.
  it("stays silent when nothing was pushed", () => {
    const state = applyUnansweredComments(baseState(), ["11"]);
    expect(commentReplyGateDecision(state).action).toBe(CommentReplyGateAction.None);
  });

  it("stays silent once every owed comment carries a reply", () => {
    const state = applyPostedReplies(pushedWithOwed(), ["11", "13"]);
    expect(unansweredComments(state)).toEqual([]);
    expect(commentReplyGateDecision(state).action).toBe(CommentReplyGateAction.None);
  });

  it("releases after the block ceiling so an unanswerable thread cannot trap the session", () => {
    const state = { ...pushedWithOwed(), commentReplyBlockCount: MAX_REPLY_BLOCKS };
    expect(commentReplyGateDecision(state).action).toBe(CommentReplyGateAction.Release);
  });
});

describe("applyReplySkip", () => {
  it("recognises the marker only as a leading echo", () => {
    expect(isReplySkipMarker('echo "MUGGLE_REPLY_SKIP: 11 escalated"')).toBe(true);
    expect(isReplySkipMarker("grep -r MUGGLE_REPLY_SKIP src/")).toBe(false);
  });

  it("clears just the comments the marker names", () => {
    const state = applyReviewWorkPush(applyUnansweredComments(baseState(), ["11", "13"]), true);
    const skipped = applyReplySkip(state, 'echo "MUGGLE_REPLY_SKIP: 11 escalated to the user"');
    expect(unansweredComments(skipped)).toEqual(["13"]);
    expect(skipped.commentReplySkipped).toBeUndefined();
  });

  // A round that never saw a usable comment id still needs a way out, or the
  // gate's own instruction names an escape hatch that cannot be typed.
  it("degrades to a session-wide skip when it names no owed comment", () => {
    const state = applyReviewWorkPush(applyUnansweredComments(baseState(), ["11"]), true);
    const skipped = applyReplySkip(state, 'echo "MUGGLE_REPLY_SKIP: thread is on someone else PR"');
    expect(skipped.commentReplySkipped).toBe(true);
    expect(commentReplyGateDecision(skipped).action).toBe(CommentReplyGateAction.None);
  });

  it("leaves state untouched when the command is not the marker", () => {
    const state = applyUnansweredComments(baseState(), ["11"]);
    expect(applyReplySkip(state, "git push origin main")).toBe(state);
  });
});
