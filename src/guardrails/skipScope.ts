import { isSameChange } from "./changeIdentity.js";
import type { ChangeIdentity, GuardrailState } from "./types.js";

/** Whether a PR the session opened belongs to the change the latest skip was verified for. */
function isPrOfSkipChange(state: GuardrailState, prUrl: string): boolean {
  return isSameChange(state.prChanges?.[prUrl], state.e2eSkipVerifiedChange);
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
 * Record the change an accepted skip was verified for, and cover every PR already opened for it.
 *
 * Same reference when there is no change to scope it to: an unscoped skip covers nothing.
 */
export function applyE2eSkipScope(state: GuardrailState, verifiedChange: ChangeIdentity | undefined): GuardrailState {
  if (!verifiedChange || !state.e2eSkipDeclaration) return state;
  const scoped = { ...state, e2eSkipVerifiedChange: verifiedChange };
  return withCoveredPrs(
    scoped,
    scoped.prsHandled.filter((prUrl) => isPrOfSkipChange(scoped, prUrl)),
  );
}
