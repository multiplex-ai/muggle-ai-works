import { ciRepairWaitRetryAt, isCiHeadSettled, isRebaseBudgetExhausted, isRebaseKeyAttempted } from "./attempts.js";
import { LINE_BREAK } from "./constants.js";
import type { ArmFeedbackObservation, ArmFloorEvidence, LastSeenPrEntry } from "./types.js";
import { resolveUnhandledFeedback } from "./unhandledFeedback.js";

/**
 * What arming may floor. The arm step marks outstanding work as seen only when the slot proves it was handled — a
 * rebase ran for this `<head>..<base-tip>` key, or fix-ci is finished with this head (see {@link isCiHeadSettled}).
 * Anything else stays unfloored, so the loop's first pass reports it and the owning session is woken to act. Arming is
 * not handling.
 *
 * A spent catch-up rebase budget is the one hold: the tick refuses every rebase until the owner raises
 * `maxCatchUpRebases`, so a rebase wake would only ask for work the verdict turns down.
 *
 * A red head waiting out a temporary blocker carries its `retry_at` into the watermark, so the loop wakes the session
 * when the wait ends; once it has ended, the head is no longer settled and its red is reported again.
 *
 * Review feedback is judged against the handled watermarks rather than the arm's read (see
 * {@link resolveUnhandledFeedback}), so a comment that predates the slot is reported, never floored unseen.
 */
export function resolveArmFloorEvidence(
  lastSeenEntry: LastSeenPrEntry,
  headSha: string,
  rebaseKey: string,
  maxCatchUpRebases: number | null,
  feedbackObservation: ArmFeedbackObservation,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): ArmFloorEvidence {
  const blockedCiDigest = lastSeenEntry.blocked?.fingerprint?.ci_digest;
  const ciRetryAt = ciRepairWaitRetryAt(lastSeenEntry, headSha);
  return {
    isRebaseKeyAttempted: rebaseKey !== "" && isRebaseKeyAttempted(lastSeenEntry, rebaseKey),
    isCiHeadSettled: headSha !== "" && isCiHeadSettled(lastSeenEntry, headSha, nowEpochSeconds),
    isRebaseBudgetExhausted: isRebaseBudgetExhausted(lastSeenEntry, maxCatchUpRebases),
    blockedCiDigest: typeof blockedCiDigest === "string" && !LINE_BREAK.test(blockedCiDigest) ? blockedCiDigest : "",
    ciRetryAt: ciRetryAt === undefined ? "" : String(ciRetryAt),
    unhandledFeedback: resolveUnhandledFeedback(lastSeenEntry, feedbackObservation),
  };
}
