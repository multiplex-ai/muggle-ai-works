import { isCiHeadAttempted, isRebaseBudgetExhausted, isRebaseKeyAttempted } from "./attempts.js";
import { LINE_BREAK } from "./constants.js";
import type { ArmFloorEvidence, LastSeenPrEntry } from "./types.js";

/**
 * What arming may floor. The arm step marks outstanding work as seen only when the slot proves a cycle ran for it —
 * a rebase for this `<head>..<base-tip>` key, a fix for this head. Anything else stays unfloored, so the loop's first
 * pass reports it and the owning session is woken to act. Arming is not handling.
 *
 * A spent catch-up rebase budget is the one hold: the tick refuses every rebase until the owner raises
 * `maxCatchUpRebases`, so a rebase wake would only ask for work the verdict turns down.
 */
export function resolveArmFloorEvidence(
  lastSeenEntry: LastSeenPrEntry,
  headSha: string,
  rebaseKey: string,
  maxCatchUpRebases: number | null,
): ArmFloorEvidence {
  const blockedCiDigest = lastSeenEntry.blocked?.fingerprint?.ci_digest;
  return {
    isRebaseKeyAttempted: rebaseKey !== "" && isRebaseKeyAttempted(lastSeenEntry, rebaseKey),
    isCiHeadAttempted: headSha !== "" && isCiHeadAttempted(lastSeenEntry, headSha),
    isRebaseBudgetExhausted: isRebaseBudgetExhausted(lastSeenEntry, maxCatchUpRebases),
    blockedCiDigest: typeof blockedCiDigest === "string" && !LINE_BREAK.test(blockedCiDigest) ? blockedCiDigest : "",
  };
}
