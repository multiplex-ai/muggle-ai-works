import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  commentReplyGateDecision,
  detectConfirmedReplies,
  detectUnansweredThreads,
  isReplySkipMarker,
  overdueThreads,
  resolveSlotForPr,
  threadForReplyTarget,
} from "../../guardrails/commentReply.js";
import { commitThread, newThreadEntry, readLedger } from "../../guardrails/ledger/store.js";
import { claimThread, coverComments, refreshHumanComments } from "../../guardrails/ledger/obligations.js";
import { LedgerProvider } from "../../guardrails/ledger/types.js";
import { LOOP_REPLY_MARKER, MAX_REPLY_BLOCKS } from "../../guardrails/constants.js";
import { CommentReplyGateAction, type GuardrailState } from "../../guardrails/types.js";

const baseState = (): GuardrailState => ({ sessionId: "s", prsHandled: [] });

const THREAD_QUERY = "gh api graphql -f query='{ reviewThreads(first: 100) { nodes { id } } }'";
const DISCUSSIONS_QUERY = "glab api projects/:id/merge_requests/12/discussions --paginate";

const comment = (databaseId: number, body: string, createdAt: string) => ({
  databaseId: databaseId,
  body: body,
  createdAt: createdAt,
});

const loopReply = (databaseId: number, createdAt: string) =>
  comment(databaseId, `${LOOP_REPLY_MARKER}\nAddressed in abc1234: done.`, createdAt);

const githubResponse = (
  threads: Array<{ id: string; isResolved: boolean; comments: ReturnType<typeof comment>[] }>,
): string =>
  JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: threads.map((thread) => ({
              id: thread.id,
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

describe("detectUnansweredThreads", () => {
  it("records a thread whose newest comment is human", () => {
    const stdout = githubResponse([
      { id: "T1", isResolved: false, comments: [comment(11, "this leaks a handle", "2026-08-01T00:00:00Z")] },
    ]);
    expect(detectUnansweredThreads(fetchInput(THREAD_QUERY, stdout))).toEqual([
      { threadId: "T1", provider: LedgerProvider.GitHub, humanCommentIds: ["11"] },
    ]);
  });

  // The C1/C2/C3 case: three separate asks are three obligations, so one reply
  // to the last cannot silently close the first two.
  it("records every consecutive human comment, not just the newest", () => {
    const stdout = githubResponse([
      {
        id: "T1",
        isResolved: false,
        comments: [
          comment(11, "this leaks a handle", "2026-08-01T00:00:00Z"),
          comment(12, "also on the error path", "2026-08-01T00:01:00Z"),
          comment(13, "and the name is wrong", "2026-08-01T00:02:00Z"),
        ],
      },
    ]);
    expect(detectUnansweredThreads(fetchInput(THREAD_QUERY, stdout))[0].humanCommentIds).toEqual([
      "11",
      "12",
      "13",
    ]);
  });

  // Anything older than the newest loop reply was already answered — counting it
  // would resurrect obligations that were met, including before the ledger existed.
  it("ignores comments older than the loop's newest reply", () => {
    const stdout = githubResponse([
      {
        id: "T1",
        isResolved: false,
        comments: [comment(11, "this leaks a handle", "2026-08-01T00:00:00Z"), loopReply(12, "2026-08-01T01:00:00Z")],
      },
    ]);
    expect(detectUnansweredThreads(fetchInput(THREAD_QUERY, stdout))).toEqual([]);
  });

  it("records only the human follow-up that post-dates the loop reply", () => {
    const stdout = githubResponse([
      {
        id: "T1",
        isResolved: false,
        comments: [
          comment(11, "this leaks a handle", "2026-08-01T00:00:00Z"),
          loopReply(12, "2026-08-01T01:00:00Z"),
          comment(13, "still leaks on the error path", "2026-08-01T02:00:00Z"),
        ],
      },
    ]);
    expect(detectUnansweredThreads(fetchInput(THREAD_QUERY, stdout))[0].humanCommentIds).toEqual(["13"]);
  });

  it("ignores a resolved thread", () => {
    const stdout = githubResponse([
      { id: "T1", isResolved: true, comments: [comment(11, "nit", "2026-08-01T00:00:00Z")] },
    ]);
    expect(detectUnansweredThreads(fetchInput(THREAD_QUERY, stdout))).toEqual([]);
  });

  it("classifies in chronological order even when the response is shuffled", () => {
    const stdout = githubResponse([
      {
        id: "T1",
        isResolved: false,
        comments: [loopReply(12, "2026-08-01T01:00:00Z"), comment(11, "this leaks", "2026-08-01T00:00:00Z")],
      },
    ]);
    expect(detectUnansweredThreads(fetchInput(THREAD_QUERY, stdout))).toEqual([]);
  });

  it("records an unresolved gitlab discussion by its discussion id", () => {
    const stdout = JSON.stringify([
      {
        id: "a1b2c3d4",
        notes: [{ id: 91, body: "this leaks a handle", resolved: false, created_at: "2026-08-01T00:00:00Z" }],
      },
    ]);
    expect(detectUnansweredThreads(fetchInput(DISCUSSIONS_QUERY, stdout))).toEqual([
      { threadId: "a1b2c3d4", provider: LedgerProvider.GitLab, humanCommentIds: ["91"] },
    ]);
  });

  it("ignores a gitlab thread whose notes are all resolved", () => {
    const stdout = JSON.stringify([
      {
        id: "a1b2c3d4",
        notes: [{ id: 91, body: "this leaks", resolved: true, created_at: "2026-08-01T00:00:00Z" }],
      },
    ]);
    expect(detectUnansweredThreads(fetchInput(DISCUSSIONS_QUERY, stdout))).toEqual([]);
  });

  it("ignores a command that is not a thread fetch", () => {
    const stdout = githubResponse([
      { id: "T1", isResolved: false, comments: [comment(11, "nit", "2026-08-01T00:00:00Z")] },
    ]);
    expect(detectUnansweredThreads(fetchInput("git log --oneline -5", stdout))).toEqual([]);
  });

  it("degrades to nothing owed when the response is not JSON", () => {
    expect(detectUnansweredThreads(fetchInput(THREAD_QUERY, "gh: not found"))).toEqual([]);
  });
});

describe("detectConfirmedReplies", () => {
  const REPLY_CMD = "gh api --method POST repos/o/r/pulls/7/comments/11/replies -f body=x";

  it("records a reply the provider confirmed, with the revision its body cites", () => {
    const created = JSON.stringify({ id: 999, body: `${LOOP_REPLY_MARKER}\nAddressed in c88acd5: fixed.` });
    expect(detectConfirmedReplies(fetchInput(REPLY_CMD, created))).toEqual([
      { targetId: "11", replySha: "c88acd5" },
    ]);
  });

  // per-comment-replies.md expects individual replies to fail and logs them, so
  // recording from the command alone would close an obligation the provider rejected.
  it("records nothing when the provider rejected the reply", () => {
    const rejected = JSON.stringify({ message: "Validation Failed" });
    expect(detectConfirmedReplies(fetchInput(REPLY_CMD, rejected))).toEqual([]);
  });

  it("records a gitlab discussion note by its discussion id", () => {
    const cmd = "glab api --method POST projects/:id/merge_requests/12/discussions/a1b2c3d4/notes -f body=x";
    const created = JSON.stringify({ id: 555, body: `${LOOP_REPLY_MARKER}\nAddressed in c88acd5: fixed.` });
    expect(detectConfirmedReplies(fetchInput(cmd, created))).toEqual([
      { targetId: "a1b2c3d4", replySha: "c88acd5" },
    ]);
  });

  it("ignores a command that posts no threaded reply", () => {
    expect(detectConfirmedReplies(fetchInput("gh pr comment 7 --body hi", '{"id":1}'))).toEqual([]);
  });
});

describe("threadForReplyTarget", () => {
  const ledger = {
    version: 1,
    threads: {
      T1: { ...newThreadEntry(LedgerProvider.GitHub), humanCommentIds: ["11", "12"] },
      a1b2c3d4: { ...newThreadEntry(LedgerProvider.GitLab), humanCommentIds: ["91"] },
    },
  };

  it("maps a github comment id back to its thread", () => {
    expect(threadForReplyTarget(ledger, "12")).toBe("T1");
  });

  it("takes a gitlab discussion id as the thread itself", () => {
    expect(threadForReplyTarget(ledger, "a1b2c3d4")).toBe("a1b2c3d4");
  });

  it("returns undefined for an unknown target", () => {
    expect(threadForReplyTarget(ledger, "999")).toBeUndefined();
  });
});

describe("isReplySkipMarker", () => {
  it("recognises the marker only as a leading echo", () => {
    expect(isReplySkipMarker('echo "MUGGLE_REPLY_SKIP: 11 escalated"')).toBe(true);
    expect(isReplySkipMarker("grep -r MUGGLE_REPLY_SKIP src/")).toBe(false);
  });
});

const PR_URL = "https://github.com/o/r/pull/7";

function slotWithPr(): { sessionsDir: string; slotPath: string } {
  const sessionsDir = mkdtempSync(join(tmpdir(), "gr-sessions-"));
  const slotPath = join(sessionsDir, "slug");
  mkdirSync(slotPath, { recursive: true });
  writeFileSync(join(slotPath, "prs.json"), JSON.stringify([{ url: PR_URL }]));
  return { sessionsDir: sessionsDir, slotPath: slotPath };
}

describe("resolveSlotForPr", () => {
  it("finds the slot whose prs.json names the PR", () => {
    const { sessionsDir, slotPath } = slotWithPr();
    expect(resolveSlotForPr(PR_URL, sessionsDir)).toBe(slotPath);
  });

  it("returns undefined when no slot tracks it", () => {
    const { sessionsDir } = slotWithPr();
    expect(resolveSlotForPr("https://github.com/o/r/pull/999", sessionsDir)).toBeUndefined();
  });
});

describe("overdueThreads", () => {
  it("reports a thread this session claimed and never covered", () => {
    const { slotPath } = slotWithPr();
    commitThread(slotPath, "T1", (entry) =>
      claimThread(refreshHumanComments(entry, ["11"]), "s"),
    );
    expect(overdueThreads(slotPath, "s")).toEqual([{ threadId: "T1", uncovered: ["11"] }]);
  });

  it("stays silent once every comment is covered", () => {
    const { slotPath } = slotWithPr();
    commitThread(slotPath, "T1", (entry) =>
      coverComments(claimThread(refreshHumanComments(entry, ["11"]), "s"), ["11"], "abc1234"),
    );
    expect(overdueThreads(slotPath, "s")).toEqual([]);
  });

  it("still reports the comments a partial reply left uncovered", () => {
    const { slotPath } = slotWithPr();
    commitThread(slotPath, "T1", (entry) =>
      coverComments(claimThread(refreshHumanComments(entry, ["11", "12", "13"]), "s"), ["13"], "abc1234"),
    );
    expect(overdueThreads(slotPath, "s")).toEqual([{ threadId: "T1", uncovered: ["11", "12"] }]);
  });

  // Another session's obligation is re-claimed by the next round that reads it,
  // but never blocks a session with no context for it.
  it("ignores a thread another session claimed", () => {
    const { slotPath } = slotWithPr();
    commitThread(slotPath, "T1", (entry) =>
      claimThread(refreshHumanComments(entry, ["11"]), "other-session"),
    );
    expect(overdueThreads(slotPath, "s")).toEqual([]);
  });

  it("reports nothing when the slot has no ledger", () => {
    const { slotPath } = slotWithPr();
    expect(readLedger(slotPath).threads).toEqual({});
    expect(overdueThreads(slotPath, "s")).toEqual([]);
  });
});

describe("commentReplyGateDecision", () => {
  const overdue = [{ threadId: "T1", uncovered: ["11", "12"] }];

  it("blocks when a claimed thread is unanswered", () => {
    const decision = commentReplyGateDecision(baseState(), overdue);
    expect(decision.action).toBe(CommentReplyGateAction.Block);
    expect(decision.unanswered).toEqual(["11", "12"]);
    expect(decision.blockCount).toBe(1);
  });

  it("stays silent when nothing is overdue", () => {
    expect(commentReplyGateDecision(baseState(), []).action).toBe(CommentReplyGateAction.None);
  });

  it("stays silent once a skip is recorded", () => {
    const skipped = { ...baseState(), commentReplySkipped: true };
    expect(commentReplyGateDecision(skipped, overdue).action).toBe(CommentReplyGateAction.None);
  });

  it("releases after the block ceiling so an unanswerable thread cannot trap the session", () => {
    const spent = { ...baseState(), commentReplyBlockCount: MAX_REPLY_BLOCKS };
    expect(commentReplyGateDecision(spent, overdue).action).toBe(CommentReplyGateAction.Release);
  });
});
