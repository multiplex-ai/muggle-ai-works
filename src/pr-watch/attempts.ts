import { REBASE_KEY_SEPARATOR } from "./constants.js";
import type { LastSeenPrEntry } from "./types.js";

function recordedCount(counts: Record<string, number> | undefined, key: string): number {
  const recorded = counts?.[key];
  return typeof recorded === "number" && Number.isFinite(recorded) ? recorded : 0;
}

/** How many rebase cycles were dispatched for one `<head>..<base-tip>` key. */
export function rebaseAttemptsFor(lastSeenEntry: LastSeenPrEntry, rebaseKey: string): number {
  return recordedCount(lastSeenEntry.conflict_resolve_attempts, rebaseKey);
}

/** How many fix-ci cycles were dispatched for one head. */
export function ciFixAttemptsFor(lastSeenEntry: LastSeenPrEntry, headSha: string): number {
  return recordedCount(lastSeenEntry.ci_fix_attempts, headSha);
}

/** Whether a rebase cycle ever ran for the key: the only evidence that lets anything floor or suppress it. */
export function isRebaseKeyAttempted(lastSeenEntry: LastSeenPrEntry, rebaseKey: string): boolean {
  return rebaseAttemptsFor(lastSeenEntry, rebaseKey) >= 1;
}

/** Whether a fix-ci cycle ever ran for the head. */
export function isCiHeadAttempted(lastSeenEntry: LastSeenPrEntry, headSha: string): boolean {
  return ciFixAttemptsFor(lastSeenEntry, headSha) >= 1;
}

/**
 * Whether the key's escalation counts. An entry in `conflict_escalated_keys` suppresses a rebase only when a rebase
 * cycle actually ran for that key and gave up; one written with no attempt behind it is ignored, as is a legacy
 * bare-SHA entry, so the rebase dispatches anyway.
 */
export function isRebaseKeyEscalated(lastSeenEntry: LastSeenPrEntry, rebaseKey: string): boolean {
  return (
    rebaseKey.includes(REBASE_KEY_SEPARATOR) &&
    (lastSeenEntry.conflict_escalated_keys ?? []).includes(rebaseKey) &&
    isRebaseKeyAttempted(lastSeenEntry, rebaseKey)
  );
}

/** Whether the head's CI escalation counts: listed in `ci_escalated_shas` and backed by at least one fix-ci cycle. */
export function isCiHeadEscalated(lastSeenEntry: LastSeenPrEntry, headSha: string): boolean {
  return (lastSeenEntry.ci_escalated_shas ?? []).includes(headSha) && isCiHeadAttempted(lastSeenEntry, headSha);
}

/**
 * Whether the PR has spent its catch-up rebase budget, judged from the counter rather than the
 * `rebase_budget_exhausted` flag: the flag is the tick's record of the block, and reading it would let a raised cap
 * stay blocked, or a flag written with no rebases behind it suppress them.
 */
export function isRebaseBudgetExhausted(lastSeenEntry: LastSeenPrEntry, maxCatchUpRebases: number | null): boolean {
  const catchUpRebases = lastSeenEntry.catch_up_rebases;
  return maxCatchUpRebases !== null && typeof catchUpRebases === "number" && catchUpRebases >= maxCatchUpRebases;
}
