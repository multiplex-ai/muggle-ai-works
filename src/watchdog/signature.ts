import { LOOP_REPLY_MARKER } from "./constants.js";
import type { ReviewThreadSnapshot, SlotPollSnapshot, SubmittedReviewSnapshot } from "./types.js";

const ACTIONABLE_BODY_REVIEW_STATES = new Set(["CHANGES_REQUESTED", "COMMENTED"]);

/**
 * The watcher's dispatch rule (contract.md Step 3a): unresolved, not outdated,
 * and the newest comment lacks the loop marker — classified by marker, never
 * by author login.
 */
export function selectActionableThreadIds(
  threads: ReviewThreadSnapshot[],
  loopReplyMarker: string = LOOP_REPLY_MARKER,
): string[] {
  return threads
    .filter(
      (thread) =>
        !thread.isResolved &&
        !thread.isOutdated &&
        !thread.newestCommentBody.includes(loopReplyMarker),
    )
    .map((thread) => thread.threadId);
}

/**
 * Body-only reviews past the slot's watermark (contract.md Step 3b): a
 * submitted CHANGES_REQUESTED/COMMENTED review with no line comments, id past
 * last_seen.lastBodyReviewId and not already escalated.
 */
export function selectActionableBodyReviewIds(args: {
  reviews: SubmittedReviewSnapshot[];
  lastBodyReviewId: number;
  escalatedReviewIds: number[];
}): number[] {
  const escalatedReviewIdSet = new Set(args.escalatedReviewIds);
  return args.reviews
    .filter(
      (review) =>
        ACTIONABLE_BODY_REVIEW_STATES.has(review.reviewState) &&
        review.lineCommentCount === 0 &&
        review.reviewId > args.lastBodyReviewId &&
        !escalatedReviewIdSet.has(review.reviewId),
    )
    .map((review) => review.reviewId);
}

export function hasSpawnSignal(pollSnapshot: SlotPollSnapshot): boolean {
  return (
    pollSnapshot.prState !== "OPEN" ||
    pollSnapshot.actionableThreadIds.length > 0 ||
    pollSnapshot.actionableBodyReviewIds.length > 0 ||
    pollSnapshot.behindBy > 0 ||
    pollSnapshot.isConflicting ||
    pollSnapshot.ciBucket === "fail"
  );
}

/**
 * Stable identity of everything that can warrant a tick. An unchanged
 * signature never spawns twice, which is what bounds cost on a durably
 * blocked PR; any movement (push, new review, base advance, CI flip) re-keys
 * it and re-arms exactly one recovery tick.
 */
export function computeSlotSignature(pollSnapshot: SlotPollSnapshot): string {
  return JSON.stringify({
    prState: pollSnapshot.prState,
    headSha: pollSnapshot.headSha,
    actionableThreadIds: [...pollSnapshot.actionableThreadIds].sort(),
    actionableBodyReviewIds: [...pollSnapshot.actionableBodyReviewIds].sort((a, b) => a - b),
    behindBy: pollSnapshot.behindBy,
    isConflicting: pollSnapshot.isConflicting,
    ciBucket: pollSnapshot.ciBucket,
  });
}
