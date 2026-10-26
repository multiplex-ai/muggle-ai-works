import { describe, it, expect } from "vitest";
import {
  applyE2eSkipScope,
  applyPrOpenedToSkipScope,
  isPrCoveredBySkip,
  normalizeWorkingTree,
} from "../../guardrails/skipScope";
import { scanForOwedWalkthroughs, type PrWalkthroughLookup } from "../../guardrails/walkthroughOwed";
import { E2eSkipCode } from "../../e2e-skip/types";
import type { GuardrailState } from "../../guardrails/types";

const TREE_A = normalizeWorkingTree("/work/repo/.claude/worktrees/fix-login") as string;
const TREE_B = normalizeWorkingTree("/work/repo/.claude/worktrees/fix-export") as string;
const PR_A = "https://github.com/o/r/pull/1";
const PR_B = "https://github.com/o/r/pull/2";
const NO_WEB_SURFACE = { code: E2eSkipCode.NoWebSurface, detail: "the repo ships no web surface" };

function sessionWith(overrides: Partial<GuardrailState> = {}): GuardrailState {
  return { sessionId: "s", prsHandled: [], ...overrides };
}

function openPr(state: GuardrailState, prUrl: string, tree: string): GuardrailState {
  return applyPrOpenedToSkipScope({ ...state, prsHandled: [...state.prsHandled, prUrl] }, prUrl, tree);
}

describe("normalizeWorkingTree", () => {
  it("spells one tree the same however the hook reported it", () => {
    expect(normalizeWorkingTree("/work/repo/")).toBe(normalizeWorkingTree("/work/repo"));
    expect(normalizeWorkingTree(undefined)).toBeUndefined();
  });
});

describe("skip scope", () => {
  it("covers the PRs already opened from the tree the skip was verified in, and no other", () => {
    const opened = openPr(openPr(sessionWith(), PR_A, TREE_A), PR_B, TREE_B);
    const skipped = applyE2eSkipScope({ ...opened, e2eSkipDeclaration: NO_WEB_SURFACE }, TREE_A);
    expect(isPrCoveredBySkip(skipped, PR_A)).toBe(true);
    expect(isPrCoveredBySkip(skipped, PR_B)).toBe(false);
  });

  it("reaches a PR opened after the skip from the same tree — Stage 6 before Stage 7 — and only that PR", () => {
    const skipped = applyE2eSkipScope(sessionWith({ e2eSkipDeclaration: NO_WEB_SURFACE }), TREE_A);
    const opened = openPr(openPr(skipped, PR_A, TREE_A), PR_B, TREE_B);
    expect(isPrCoveredBySkip(opened, PR_A)).toBe(true);
    expect(isPrCoveredBySkip(opened, PR_B)).toBe(false);
  });

  it("keeps an earlier change's coverage when a later skip moves to another tree", () => {
    const firstSkip = applyE2eSkipScope(openPr(sessionWith({ e2eSkipDeclaration: NO_WEB_SURFACE }), PR_A, TREE_A), TREE_A);
    const secondSkip = applyE2eSkipScope(openPr(firstSkip, PR_B, TREE_B), TREE_B);
    expect(isPrCoveredBySkip(secondSkip, PR_A)).toBe(true);
    expect(isPrCoveredBySkip(secondSkip, PR_B)).toBe(true);
  });

  it("covers nothing for a skip with no tree to scope it to", () => {
    const opened = openPr(sessionWith({ e2eSkipDeclaration: NO_WEB_SURFACE }), PR_A, TREE_A);
    expect(applyE2eSkipScope(opened, undefined)).toBe(opened);
    expect(isPrCoveredBySkip(opened, PR_A)).toBe(false);
  });
});

describe("scanForOwedWalkthroughs with scoped skips", () => {
  // Every PR carries a skip marker and no rendered walkthrough.
  const skipMarkedOnly: PrWalkthroughLookup = {
    branchPrUrl: () => null,
    prCarriesWalkthrough: (_prUrl, acceptsSkip) => acceptsSkip,
  };

  it("settles a covered PR's skip marker even though another change in the session ran E2E", () => {
    const skipped = applyE2eSkipScope(
      openPr(openPr(sessionWith({ e2eRun: true, e2eSkipDeclaration: NO_WEB_SURFACE }), PR_A, TREE_A), PR_B, TREE_B),
      TREE_A,
    );
    const scan = scanForOwedWalkthroughs(skipped, skipMarkedOnly);
    expect(scan.verified).toEqual([PR_A]);
    expect(scan.owed).toEqual([PR_B]);
  });
});
