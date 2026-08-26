import { describe, it, expect } from "vitest";
import { hostname } from "os";
import {
  claimThread,
  coverComments,
  refreshHumanComments,
  releaseClaim,
  threadState,
  uncoveredComments,
} from "../../guardrails/ledger/obligations.js";
import { LedgerProvider, ThreadState, type ThreadEntry } from "../../guardrails/ledger/types.js";

// A pid high enough that no live process owns it, standing in for a worker that
// died holding a claim.
const DEAD_PID = 0x7ffffffe;

const entry = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  provider: LedgerProvider.GitHub,
  generation: 1,
  humanCommentIds: ["11"],
  coveredCommentIds: [],
  claim: null,
  lastClaimedBySessionId: "s",
  lastReplySha: null,
  updatedAt: "2026-08-26T00:00:00Z",
  ...over,
});

describe("threadState", () => {
  it("is processed when every human comment is covered", () => {
    expect(
      threadState(entry({ humanCommentIds: ["11", "12"], coveredCommentIds: ["11", "12"] })),
    ).toBe(ThreadState.Processed);
  });

  it("is processing while a live claim is held", () => {
    const claim = { sessionId: "s", pid: process.pid, host: hostname(), claimedAt: new Date().toISOString() };
    expect(threadState(entry({ claim: claim }))).toBe(ThreadState.Processing);
  });

  // A dead claim needs no sweep: the entry simply reads unprocessed again, and
  // the next round re-claims it.
  it("falls back to unprocessed when the claim holder is dead", () => {
    const claim = { sessionId: "s", pid: DEAD_PID, host: hostname(), claimedAt: new Date().toISOString() };
    expect(threadState(entry({ claim: claim }))).toBe(ThreadState.Unprocessed);
  });

  // A claim made elsewhere cannot be probed, so it holds until a backstop far
  // beyond any plausible round — never a timer short enough to race a live worker.
  it("honours a fresh claim from another machine but not an ancient one", () => {
    const fresh = { sessionId: "s", pid: DEAD_PID, host: "elsewhere", claimedAt: new Date().toISOString() };
    expect(threadState(entry({ claim: fresh }))).toBe(ThreadState.Processing);
    const ancient = { sessionId: "s", pid: DEAD_PID, host: "elsewhere", claimedAt: "2020-01-01T00:00:00Z" };
    expect(threadState(entry({ claim: ancient }))).toBe(ThreadState.Unprocessed);
  });

  it("is unprocessed when one of several comments is uncovered", () => {
    const partial = entry({ humanCommentIds: ["11", "12", "13"], coveredCommentIds: ["13"] });
    expect(threadState(partial)).toBe(ThreadState.Unprocessed);
    expect(uncoveredComments(partial)).toEqual(["11", "12"]);
  });

  it("is processed when the thread has no human comments left", () => {
    expect(threadState(entry({ humanCommentIds: [] }))).toBe(ThreadState.Processed);
  });
});

describe("claim, cover, release", () => {
  it("records the claimant and remembers it after release", () => {
    const claimed = claimThread(entry(), "session-a");
    expect(claimed.claim?.sessionId).toBe("session-a");
    const released = releaseClaim(claimed);
    expect(released.claim).toBeNull();
    expect(released.lastClaimedBySessionId).toBe("session-a");
  });

  it("adds covered comments without duplicating", () => {
    const covered = coverComments(coverComments(entry(), ["11"], "abc1234"), ["11", "12"], "abc1234");
    expect(covered.coveredCommentIds).toEqual(["11", "12"]);
    expect(covered.lastReplySha).toBe("abc1234");
  });

  it("keeps the previous reply sha when a cover names none", () => {
    const covered = coverComments(coverComments(entry(), ["11"], "abc1234"), ["12"], null);
    expect(covered.lastReplySha).toBe("abc1234");
  });

  // The provider stays the source of truth for what exists; a comment that is
  // gone must not linger as an obligation.
  it("refreshes human comments from live state, dropping ones that no longer exist", () => {
    const seeded = entry({ humanCommentIds: ["11", "12"], coveredCommentIds: ["11"] });
    const refreshed = refreshHumanComments(seeded, ["12", "13"]);
    expect(refreshed.humanCommentIds).toEqual(["12", "13"]);
    expect(refreshed.coveredCommentIds).toEqual(["11"]);
    expect(uncoveredComments(refreshed)).toEqual(["12", "13"]);
  });
});
