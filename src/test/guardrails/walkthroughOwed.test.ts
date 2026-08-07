import { describe, it, expect } from "vitest";
import {
  scanForOwedWalkthroughs,
  walkthroughGateDecision,
  type PrWalkthroughLookup,
} from "../../guardrails/walkthroughOwed";
import { WalkthroughGateAction, type GuardrailState } from "../../guardrails/types";

const PR_OPENED = "https://github.com/o/r/pull/1";
const PR_BRANCH = "https://github.com/o/r/pull/2";

function stateWith(overrides: Partial<GuardrailState> = {}): GuardrailState {
  return { sessionId: "s", prsHandled: [], e2eRun: true, ...overrides };
}

function lookup(
  branchPrUrl: string | null,
  carrying: string[] = [],
  unreachable: string[] = [],
): PrWalkthroughLookup {
  return {
    branchPrUrl: () => branchPrUrl,
    prCarriesWalkthrough: (prUrl) => carrying.includes(prUrl) || unreachable.includes(prUrl),
  };
}

describe("scanForOwedWalkthroughs", () => {
  it("owes a PR opened this session that carries no walkthrough", () => {
    const scan = scanForOwedWalkthroughs(stateWith({ prsHandled: [PR_OPENED] }), lookup(null));
    expect(scan.owed).toEqual([PR_OPENED]);
    expect(scan.verified).toEqual([]);
  });

  it("owes the branch's PR even when the session opened nothing — the change-driven case", () => {
    const scan = scanForOwedWalkthroughs(stateWith(), lookup(PR_BRANCH));
    expect(scan.owed).toEqual([PR_BRANCH]);
  });

  it("unions both sources without duplicating a PR that is in each", () => {
    const scan = scanForOwedWalkthroughs(
      stateWith({ prsHandled: [PR_OPENED, PR_BRANCH] }),
      lookup(PR_BRANCH),
    );
    expect(scan.owed.sort()).toEqual([PR_OPENED, PR_BRANCH]);
  });

  it("verifies rather than owes a PR that already carries a walkthrough", () => {
    const scan = scanForOwedWalkthroughs(
      stateWith({ prsHandled: [PR_OPENED] }),
      lookup(null, [PR_OPENED]),
    );
    expect(scan.owed).toEqual([]);
    expect(scan.verified).toEqual([PR_OPENED]);
  });

  it("fails open — an unreachable PR is never owed", () => {
    const scan = scanForOwedWalkthroughs(
      stateWith({ prsHandled: [PR_OPENED] }),
      lookup(null, [], [PR_OPENED]),
    );
    expect(scan.owed).toEqual([]);
  });

  it("owes nothing when there is no PR in play at all", () => {
    expect(scanForOwedWalkthroughs(stateWith(), lookup(null)).owed).toEqual([]);
  });
});

describe("walkthroughGateDecision", () => {
  it("blocks and increments when a walkthrough is owed", () => {
    const decision = walkthroughGateDecision(stateWith(), [PR_OPENED]);
    expect(decision.action).toBe(WalkthroughGateAction.Block);
    expect(decision.blockCount).toBe(1);
    expect(decision.owed).toEqual([PR_OPENED]);
  });

  it("stays quiet when no acceptance run happened", () => {
    const decision = walkthroughGateDecision(stateWith({ e2eRun: false }), [PR_OPENED]);
    expect(decision.action).toBe(WalkthroughGateAction.None);
  });

  it("stays quiet once a walkthrough is recorded", () => {
    const decision = walkthroughGateDecision(stateWith({ walkthroughPosted: true }), [PR_OPENED]);
    expect(decision.action).toBe(WalkthroughGateAction.None);
  });

  it("stays quiet once a skip is declared", () => {
    const decision = walkthroughGateDecision(stateWith({ walkthroughSkipped: true }), [PR_OPENED]);
    expect(decision.action).toBe(WalkthroughGateAction.None);
  });

  it("stays quiet when nothing is owed", () => {
    expect(walkthroughGateDecision(stateWith(), []).action).toBe(WalkthroughGateAction.None);
  });

  it("releases once the block budget is spent so a session can't be trapped", () => {
    const decision = walkthroughGateDecision(stateWith({ walkthroughBlockCount: 3 }), [PR_OPENED]);
    expect(decision.action).toBe(WalkthroughGateAction.Release);
  });
});
