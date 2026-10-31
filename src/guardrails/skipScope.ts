import { isSameChange } from "./changeIdentity.js";
import type { ChangeIdentity, GuardrailState } from "./types.js";

/** Whether a PR the session opened belongs to the change the current skip declaration was verified for. */
export function isPrOfSkipChange(state: GuardrailState, prUrl: string): boolean {
  return isSameChange(state.prChanges?.[prUrl], state.e2eSkipVerifiedChange);
}

/**
 * The handled PRs the current skip declaration's reason belongs on: those of its own change.
 *
 * A PR an earlier skip covered for another change keeps that skip's record.
 */
export function prsOfSkipChange(state: GuardrailState): string[] {
  return state.prsHandled.filter((prUrl) => isPrOfSkipChange(state, prUrl));
}

function withCoveredPrs(state: GuardrailState, prUrls: string[]): GuardrailState {
  const covered = new Set(state.e2eSkipCoveredPrs ?? []);
  const uncovered = prUrls.filter((prUrl) => !covered.has(prUrl));
  if (uncovered.length === 0) return state;
  return { ...state, e2eSkipCoveredPrs: [...covered, ...uncovered] };
}

/**
 * Whether a skip has been applied to this PR, so a skip marker on it settles it.
 *
 * A skip is verified for one change — a repo and branch — and vouches for it
 * alone; a PR of any other change owes its own run or skip, however the
 * session's working directory sat when it was opened.
 */
export function isPrCoveredBySkip(state: GuardrailState, prUrl: string): boolean {
  return (state.e2eSkipCoveredPrs ?? []).includes(prUrl);
}

/**
 * Record the change a PR belongs to, and cover it with the latest skip when it is that skip's change.
 *
 * This is what lets a skip declared before its PR existed — Stage 6 before
 * Stage 7 — reach that PR, and only that PR. A PR whose change is unknown is
 * never covered.
 */
export function applyPrOpenedToSkipScope(
  state: GuardrailState,
  prUrl: string,
  prChange: ChangeIdentity | undefined,
): GuardrailState {
  if (!prChange) return state;
  const recorded = { ...state, prChanges: { ...state.prChanges, [prUrl]: prChange } };
  return isPrOfSkipChange(recorded, prUrl) && recorded.e2eSkipDeclaration ? withCoveredPrs(recorded, [prUrl]) : recorded;
}

/**
 * Scope a newly accepted skip declaration to the change it was verified for, and cover every PR already opened for it.
 *
 * A declaration whose change could not be resolved is scoped to none, so it never pairs with the change of
 * the declaration before it; an unscoped skip covers nothing. Coverage an earlier skip gave its own PRs stays.
 */
export function applyE2eSkipScope(state: GuardrailState, verifiedChange: ChangeIdentity | undefined): GuardrailState {
  if (!state.e2eSkipDeclaration) return state;
  if (!verifiedChange) {
    if (!state.e2eSkipVerifiedChange) return state;
    const { e2eSkipVerifiedChange: _previousDeclarationChange, ...unscoped } = state;
    return unscoped;
  }
  const scoped = { ...state, e2eSkipVerifiedChange: verifiedChange };
  return withCoveredPrs(scoped, prsOfSkipChange(scoped));
}
