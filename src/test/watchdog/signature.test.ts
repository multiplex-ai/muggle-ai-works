import { describe, it, expect } from "vitest";
import { LOOP_REPLY_MARKER } from "../../watchdog/constants.js";
import {
  computeSlotSignature,
  hasSpawnSignal,
  selectActionableBodyReviewIds,
  selectActionableThreadIds,
} from "../../watchdog/signature.js";
import { CiRollupBucket, SlotPollSnapshot } from "../../watchdog/types.js";

function quietOpenSnapshot(overrides: Partial<SlotPollSnapshot> = {}): SlotPollSnapshot {
  return {
    prState: "OPEN",
    headSha: "abc1234",
    actionableThreadIds: [],
    actionableBodyReviewIds: [],
    behindBy: 0,
    isConflicting: false,
    ciBucket: CiRollupBucket.Pass,
    ...overrides,
  };
}

describe("selectActionableThreadIds", () => {
  it("keeps unresolved, not-outdated threads whose newest comment lacks the loop marker", () => {
    const actionableThreadIds = selectActionableThreadIds([
      { threadId: "T1", isResolved: false, isOutdated: false, newestCommentBody: "please fix" },
      { threadId: "T2", isResolved: true, isOutdated: false, newestCommentBody: "please fix" },
      { threadId: "T3", isResolved: false, isOutdated: true, newestCommentBody: "please fix" },
      {
        threadId: "T4",
        isResolved: false,
        isOutdated: false,
        newestCommentBody: `done in abc1234 ${LOOP_REPLY_MARKER}`,
      },
    ]);
    expect(actionableThreadIds).toEqual(["T1"]);
  });
});

describe("selectActionableBodyReviewIds", () => {
  it("keeps body-only CHANGES_REQUESTED/COMMENTED reviews past the watermark, minus escalated", () => {
    const actionableBodyReviewIds = selectActionableBodyReviewIds({
      reviews: [
        { reviewId: 90, reviewState: "CHANGES_REQUESTED", lineCommentCount: 0 },
        { reviewId: 101, reviewState: "CHANGES_REQUESTED", lineCommentCount: 0 },
        { reviewId: 102, reviewState: "COMMENTED", lineCommentCount: 3 },
        { reviewId: 103, reviewState: "APPROVED", lineCommentCount: 0 },
        { reviewId: 104, reviewState: "COMMENTED", lineCommentCount: 0 },
        { reviewId: 105, reviewState: "COMMENTED", lineCommentCount: 0 },
      ],
      lastBodyReviewId: 100,
      escalatedReviewIds: [105],
    });
    expect(actionableBodyReviewIds).toEqual([101, 104]);
  });
});

describe("hasSpawnSignal", () => {
  it("a quiet, current, green open PR has no signal", () => {
    expect(hasSpawnSignal(quietOpenSnapshot())).toBe(false);
    expect(hasSpawnSignal(quietOpenSnapshot({ ciBucket: CiRollupBucket.Pending }))).toBe(false);
    expect(hasSpawnSignal(quietOpenSnapshot({ ciBucket: CiRollupBucket.None }))).toBe(false);
  });

  it.each([
    ["terminal PR", quietOpenSnapshot({ prState: "MERGED" })],
    ["actionable thread", quietOpenSnapshot({ actionableThreadIds: ["T1"] })],
    ["body-only review", quietOpenSnapshot({ actionableBodyReviewIds: [101] })],
    ["behind base", quietOpenSnapshot({ behindBy: 2 })],
    ["conflicting", quietOpenSnapshot({ isConflicting: true })],
    ["red CI", quietOpenSnapshot({ ciBucket: CiRollupBucket.Fail })],
  ])("%s is a signal", (_label, pollSnapshot) => {
    expect(hasSpawnSignal(pollSnapshot)).toBe(true);
  });
});

describe("computeSlotSignature", () => {
  it("is order-insensitive over ids and stable for identical state", () => {
    const first = computeSlotSignature(
      quietOpenSnapshot({ actionableThreadIds: ["T2", "T1"], actionableBodyReviewIds: [104, 101] }),
    );
    const second = computeSlotSignature(
      quietOpenSnapshot({ actionableThreadIds: ["T1", "T2"], actionableBodyReviewIds: [101, 104] }),
    );
    expect(first).toBe(second);
  });

  it("re-keys on push, base advance, and CI flip", () => {
    const baseline = computeSlotSignature(quietOpenSnapshot());
    expect(computeSlotSignature(quietOpenSnapshot({ headSha: "def5678" }))).not.toBe(baseline);
    expect(computeSlotSignature(quietOpenSnapshot({ behindBy: 1 }))).not.toBe(baseline);
    expect(computeSlotSignature(quietOpenSnapshot({ ciBucket: CiRollupBucket.Fail }))).not.toBe(
      baseline,
    );
  });
});
