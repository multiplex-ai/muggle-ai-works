import { describe, it, expect } from "vitest";
import {
  applyE2eSkipScope,
  applyPrOpenedToSkipScope,
  isPrCoveredBySkip,
  isPrOfSkipChange,
  prsOfSkipChange,
} from "../../guardrails/skipScope";
import { scanForOwedWalkthroughs, type PrWalkthroughLookup } from "../../guardrails/walkthroughOwed";
import { E2eSkipCode } from "../../e2e-skip/types";
import type { ChangeIdentity, GuardrailState } from "../../guardrails/types";

const CHANGE_A: ChangeIdentity = { repo: "github.com/o/r", branch: "users/me/fix-login" };
const CHANGE_B: ChangeIdentity = { repo: "github.com/o/r", branch: "users/me/fix-export" };
const OTHER_REPO_SAME_BRANCH: ChangeIdentity = { repo: "github.com/o/web", branch: "users/me/fix-login" };
const PR_A = "https://github.com/o/r/pull/1";
const PR_B = "https://github.com/o/r/pull/2";
const PR_OTHER_REPO = "https://github.com/o/web/pull/3";
const PR_A_FOLLOW_UP = "https://github.com/o/r/pull/4";
const NO_WEB_SURFACE = { code: E2eSkipCode.NoWebSurface, detail: "the repo ships no web surface" };
const LATER_NO_WEB_SURFACE = { code: E2eSkipCode.NoWebSurface, detail: "a migration script with no page" };

function sessionWith(overrides: Partial<GuardrailState> = {}): GuardrailState {
  return { sessionId: "s", prsHandled: [], ...overrides };
}

function openPr(state: GuardrailState, prUrl: string, change: ChangeIdentity | undefined): GuardrailState {
  return applyPrOpenedToSkipScope({ ...state, prsHandled: [...state.prsHandled, prUrl] }, prUrl, change);
}

describe("skip scope", () => {
  it("covers the PRs already opened for the change the skip was verified for, and no other", () => {
    const opened = openPr(openPr(sessionWith(), PR_A, CHANGE_A), PR_B, CHANGE_B);
    const skipped = applyE2eSkipScope({ ...opened, e2eSkipDeclaration: NO_WEB_SURFACE }, CHANGE_A);
    expect(isPrCoveredBySkip(skipped, PR_A)).toBe(true);
    expect(isPrCoveredBySkip(skipped, PR_B)).toBe(false);
  });

  it("reaches a PR opened after the skip for the same change — Stage 6 before Stage 7 — and only that PR", () => {
    const skipped = applyE2eSkipScope(sessionWith({ e2eSkipDeclaration: NO_WEB_SURFACE }), CHANGE_A);
    const opened = openPr(openPr(skipped, PR_A, CHANGE_A), PR_B, CHANGE_B);
    expect(isPrCoveredBySkip(opened, PR_A)).toBe(true);
    expect(isPrCoveredBySkip(opened, PR_B)).toBe(false);
  });

  it("never covers a PR in another repo, even on a branch of the same name", () => {
    const skipped = applyE2eSkipScope(sessionWith({ e2eSkipDeclaration: NO_WEB_SURFACE }), CHANGE_A);
    const opened = openPr(skipped, PR_OTHER_REPO, OTHER_REPO_SAME_BRANCH);
    expect(isPrCoveredBySkip(opened, PR_OTHER_REPO)).toBe(false);
  });

  it("never covers a PR whose change could not be resolved", () => {
    const skipped = applyE2eSkipScope(sessionWith({ e2eSkipDeclaration: NO_WEB_SURFACE }), CHANGE_A);
    const opened = openPr(skipped, PR_A, undefined);
    expect(isPrCoveredBySkip(opened, PR_A)).toBe(false);
    expect(applyE2eSkipScope(opened, CHANGE_A).e2eSkipCoveredPrs ?? []).not.toContain(PR_A);
  });

  it("keeps an earlier change's coverage when a later skip moves to another change", () => {
    const firstSkip = applyE2eSkipScope(openPr(sessionWith({ e2eSkipDeclaration: NO_WEB_SURFACE }), PR_A, CHANGE_A), CHANGE_A);
    const secondSkip = applyE2eSkipScope(openPr(firstSkip, PR_B, CHANGE_B), CHANGE_B);
    expect(isPrCoveredBySkip(secondSkip, PR_A)).toBe(true);
    expect(isPrCoveredBySkip(secondSkip, PR_B)).toBe(true);
  });

  it("covers nothing for a skip with no change to scope it to", () => {
    const opened = openPr(sessionWith({ e2eSkipDeclaration: NO_WEB_SURFACE }), PR_A, CHANGE_A);
    expect(applyE2eSkipScope(opened, undefined)).toBe(opened);
    expect(isPrCoveredBySkip(opened, PR_A)).toBe(false);
  });

  // The tree's change goes unresolved when its git calls time out under load.
  it("never pairs a declaration whose change went unresolved with the change of the one before it", () => {
    const firstSkip = applyE2eSkipScope(openPr(sessionWith({ e2eSkipDeclaration: NO_WEB_SURFACE }), PR_A, CHANGE_A), CHANGE_A);
    const secondSkip = applyE2eSkipScope({ ...firstSkip, e2eSkipDeclaration: LATER_NO_WEB_SURFACE }, undefined);
    expect(secondSkip.e2eSkipVerifiedChange).toBeUndefined();
    expect(isPrCoveredBySkip(secondSkip, PR_A)).toBe(true);
    expect(prsOfSkipChange(secondSkip)).toEqual([]);

    const reopened = openPr(secondSkip, PR_A_FOLLOW_UP, CHANGE_A);
    expect(isPrCoveredBySkip(reopened, PR_A_FOLLOW_UP)).toBe(false);
  });

  it("puts a declaration's reason only on the PRs of its own change", () => {
    const firstSkip = applyE2eSkipScope(openPr(sessionWith({ e2eSkipDeclaration: NO_WEB_SURFACE }), PR_A, CHANGE_A), CHANGE_A);
    const secondSkip = applyE2eSkipScope(openPr({ ...firstSkip, e2eSkipDeclaration: LATER_NO_WEB_SURFACE }, PR_B, CHANGE_B), CHANGE_B);
    expect(prsOfSkipChange(secondSkip)).toEqual([PR_B]);
    expect(isPrOfSkipChange(secondSkip, PR_A)).toBe(false);
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
      openPr(openPr(sessionWith({ e2eRun: true, e2eSkipDeclaration: NO_WEB_SURFACE }), PR_A, CHANGE_A), PR_B, CHANGE_B),
      CHANGE_A,
    );
    const scan = scanForOwedWalkthroughs(skipped, skipMarkedOnly);
    expect(scan.verified).toEqual([PR_A]);
    expect(scan.owed).toEqual([PR_B]);
  });
});
