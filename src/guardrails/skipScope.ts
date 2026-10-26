import { resolve } from "path";
import type { GuardrailState } from "./types.js";

/**
 * A working-tree path in the one spelling two hooks agree on, or undefined when the hook had none.
 *
 * Windows paths compare case-insensitively and arrive with either slash, so
 * both are folded; a trailing separator is dropped.
 *
 * Output shape: `"c:/users/me/repo/.claude/worktrees/fix-login"`
 */
export function normalizeWorkingTree(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const forwardSlashed = resolve(cwd).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? forwardSlashed.toLowerCase() : forwardSlashed;
}

/** Whether a PR the session opened was opened from the tree the latest skip was verified in. */
function isOpenedFromSkipTree(state: GuardrailState, prUrl: string): boolean {
  const skipTree = state.e2eSkipVerifiedInTree;
  return skipTree !== undefined && state.prWorkingTrees?.[prUrl] === skipTree;
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
 * A skip is verified in one working tree and vouches for that change alone; a
 * PR from any other tree is a different change and owes its own run or skip.
 */
export function isPrCoveredBySkip(state: GuardrailState, prUrl: string): boolean {
  return (state.e2eSkipCoveredPrs ?? []).includes(prUrl);
}

/**
 * Record the tree a PR was opened from, and cover it with the latest skip when it came from that skip's tree.
 *
 * This is what lets a skip declared before its PR existed — Stage 6 before
 * Stage 7 — reach that PR, and only that PR.
 */
export function applyPrOpenedToSkipScope(
  state: GuardrailState,
  prUrl: string,
  openedFromTree: string | undefined,
): GuardrailState {
  if (!openedFromTree) return state;
  const recorded = { ...state, prWorkingTrees: { ...state.prWorkingTrees, [prUrl]: openedFromTree } };
  return isOpenedFromSkipTree(recorded, prUrl) && recorded.e2eSkipDeclaration ? withCoveredPrs(recorded, [prUrl]) : recorded;
}

/**
 * Record the tree an accepted skip was verified in, and cover every PR already opened from it.
 *
 * Same reference when there is no tree to scope it to: an unscoped skip covers nothing.
 */
export function applyE2eSkipScope(state: GuardrailState, verifiedInTree: string | undefined): GuardrailState {
  if (!verifiedInTree || !state.e2eSkipDeclaration) return state;
  const scoped = { ...state, e2eSkipVerifiedInTree: verifiedInTree };
  return withCoveredPrs(
    scoped,
    scoped.prsHandled.filter((prUrl) => isOpenedFromSkipTree(scoped, prUrl)),
  );
}
