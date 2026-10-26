import { isCiHeadAttempted, isRebaseKeyAttempted } from "./attempts.js";
import { LINE_BREAK } from "./constants.js";
import type { ArmFloorEvidence, LastSeenPrEntry } from "./types.js";

/**
 * What arming may floor. The arm step marks outstanding work as seen only when the slot proves a cycle ran for it —
 * a rebase for this `<head>..<base-tip>` key, a fix for this head. Anything else stays unfloored, so the loop's first
 * pass reports it and the owning session is woken to act. Arming is not handling.
 */
export function resolveArmFloorEvidence(
  lastSeenEntry: LastSeenPrEntry,
  headSha: string,
  rebaseKey: string,
): ArmFloorEvidence {
  const blockedCiDigest = lastSeenEntry.blocked?.fingerprint?.ci_digest;
  return {
    isRebaseKeyAttempted: rebaseKey !== "" && isRebaseKeyAttempted(lastSeenEntry, rebaseKey),
    isCiHeadAttempted: headSha !== "" && isCiHeadAttempted(lastSeenEntry, headSha),
    blockedCiDigest: typeof blockedCiDigest === "string" && !LINE_BREAK.test(blockedCiDigest) ? blockedCiDigest : "",
  };
}
