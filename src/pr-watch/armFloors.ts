import { isCiHeadSettled, isRebaseBudgetExhausted, isRebaseKeyAttempted } from "./attempts.js";
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
 * Review feedback is judged against the handled watermarks rather than the arm's read (see
 * {@link resolveUnhandledFeedback}), so a comment that predates the slot is reported, never floored unseen.
 */
export function resolveArmFloorEvidence(
  lastSeenEntry: LastSeenPrEntry,
  headSha: string,
  rebaseKey: string,
  maxCatchUpRebases: number | null,
  feedbackObservation: ArmFeedbackObservation,
): ArmFloorEvidence {
  const blockedCiDigest = lastSeenEntry.blocked?.fingerprint?.ci_digest;
  return {
    isRebaseKeyAttempted: rebaseKey !== "" && isRebaseKeyAttempted(lastSeenEntry, rebaseKey),
    isCiHeadSettled: headSha !== "" && isCiHeadSettled(lastSeenEntry, headSha),
    isRebaseBudgetExhausted: isRebaseBudgetExhausted(lastSeenEntry, maxCatchUpRebases),
    blockedCiDigest: typeof blockedCiDigest === "string" && !LINE_BREAK.test(blockedCiDigest) ? blockedCiDigest : "",
    unhandledFeedback: resolveUnhandledFeedback(lastSeenEntry, feedbackObservation),
  };
}
