import {
  ciFixAttemptsFor,
  isCiHeadBudgetSpent,
  isCiHeadEscalated,
  isRebaseBudgetExhausted,
  isRebaseKeyEscalated,
  rebaseAttemptsFor,
} from "./attempts.js";
import { MAX_CI_FIX_ATTEMPTS_PER_HEAD, MAX_REBASE_ATTEMPTS_PER_KEY } from "./constants.js";
import {
  CiRollupBucket,
  WatchTickVerdict,
  type LastSeenPrEntry,
  type WatchPreferences,
  type WatchTickObservation,
} from "./types.js";

/**
 * The watcher tick's Steps 5-7 (`muggle-pr-followup/contract.md`) for a PR with no actionable review feedback:
 * rebase a due branch, fix red CI, or idle — and when idling, whether a human must clear the hold.
 *
 * An escalation suppresses dispatch only when a cycle actually ran and gave up on the same key or head
 * (see {@link isRebaseKeyEscalated}); an entry written without an attempt behind it is ignored, so the work dispatches.
 * A red head whose fix-ci budget is spent holds as escalated even when no escalation was written: idling there would
 * leave the PR red with nobody told.
 */
export function resolveWatchTickVerdict(
  lastSeenEntry: LastSeenPrEntry,
  observation: WatchTickObservation,
  preferences: WatchPreferences,
): WatchTickVerdict {
  const { headSha, rebaseKey } = observation;
  if (observation.isRebaseDue) {
    if (isRebaseBudgetExhausted(lastSeenEntry, preferences.maxCatchUpRebases)) {
      return WatchTickVerdict.BlockRebaseBudgetExhausted;
    }
    const isRebaseKeyBudgetLeft = rebaseAttemptsFor(lastSeenEntry, rebaseKey) < MAX_REBASE_ATTEMPTS_PER_KEY;
    if (isRebaseKeyBudgetLeft && !isRebaseKeyEscalated(lastSeenEntry, rebaseKey)) return WatchTickVerdict.DispatchRebase;
  }
  if (observation.ciBucket === CiRollupBucket.Red) {
    const isCiHeadBudgetLeft = ciFixAttemptsFor(lastSeenEntry, headSha) < MAX_CI_FIX_ATTEMPTS_PER_HEAD;
    if (isCiHeadBudgetLeft && !isCiHeadEscalated(lastSeenEntry, headSha)) return WatchTickVerdict.DispatchFixCi;
  }
  if (isRebaseKeyEscalated(lastSeenEntry, rebaseKey)) return WatchTickVerdict.BlockConflictEscalated;
  const isRedHeadOutOfAttempts =
    observation.ciBucket === CiRollupBucket.Red && isCiHeadBudgetSpent(lastSeenEntry, headSha);
  if (isCiHeadEscalated(lastSeenEntry, headSha) || isRedHeadOutOfAttempts) return WatchTickVerdict.BlockCiEscalated;
  if ((lastSeenEntry.escalated_review_ids ?? []).length > 0) return WatchTickVerdict.BlockReviewsEscalated;
  return WatchTickVerdict.Idle;
}
