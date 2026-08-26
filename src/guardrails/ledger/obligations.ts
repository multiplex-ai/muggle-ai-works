import { hostname } from "os";
import { isProcessAlive } from "../store/fileLock.js";
import { FOREIGN_CLAIM_EXPIRY_MS } from "./constants.js";
import { ThreadState, type Claimant, type ThreadEntry } from "./types.js";

/**
 * Whether a claim still holds.
 *
 * Liveness, not elapsed time: a round legitimately runs for twenty minutes, so
 * any timer short enough to recover from a crash would expire out from under a
 * slow worker and hand the thread to a second one. A claim from another machine
 * cannot be probed, so it falls back to a backstop far beyond any plausible round.
 */
export function isClaimLive(claim: Claimant | null, now: number = Date.now()): boolean {
  if (!claim) return false;
  if (claim.host !== hostname()) {
    return now - Date.parse(claim.claimedAt) < FOREIGN_CLAIM_EXPIRY_MS;
  }
  return isProcessAlive(claim.pid);
}

/** The human comments in this thread with no declared reply. */
export function uncoveredComments(entry: ThreadEntry): string[] {
  const covered = new Set(entry.coveredCommentIds);
  return entry.humanCommentIds.filter((commentId) => !covered.has(commentId));
}

/** The thread's state, derived from its fields. */
export function threadState(entry: ThreadEntry, now: number = Date.now()): ThreadState {
  if (uncoveredComments(entry).length === 0) return ThreadState.Processed;
  if (isClaimLive(entry.claim, now)) return ThreadState.Processing;
  return ThreadState.Unprocessed;
}

/** Take the thread for this session, recording the claimant so a released claim still says who worked it. */
export function claimThread(entry: ThreadEntry, sessionId: string): ThreadEntry {
  return {
    ...entry,
    claim: {
      sessionId: sessionId,
      pid: process.pid,
      host: hostname(),
      claimedAt: new Date().toISOString(),
    },
    lastClaimedBySessionId: sessionId,
  };
}

/** Declare comments answered by the reply at `replySha`. One reply may cover several comments. */
export function coverComments(
  entry: ThreadEntry,
  commentIds: string[],
  replySha: string | null,
): ThreadEntry {
  const covered = [...entry.coveredCommentIds];
  for (const commentId of commentIds) if (!covered.includes(commentId)) covered.push(commentId);
  return { ...entry, coveredCommentIds: covered, lastReplySha: replySha ?? entry.lastReplySha };
}

/** Drop the claim at the end of a round; the last claimant survives it. */
export function releaseClaim(entry: ThreadEntry): ThreadEntry {
  return { ...entry, claim: null };
}

/** Replace the human-comment list from live provider state, leaving the covered set alone. */
export function refreshHumanComments(entry: ThreadEntry, humanCommentIds: string[]): ThreadEntry {
  return { ...entry, humanCommentIds: [...humanCommentIds] };
}
