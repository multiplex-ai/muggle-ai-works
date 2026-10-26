import { describe, it, expect } from "vitest";
import {
  applyPrOpenedToWalkthroughs,
  isWalkthroughGateArmed,
  isWalkthroughScanCurrent,
  scanForOwedWalkthroughs,
  walkthroughGateDecision,
  withoutPostedPrs,
  type PrWalkthroughLookup,
} from "../../guardrails/walkthroughOwed";
import { WalkthroughGateAction, type GuardrailState } from "../../guardrails/types";
import { E2eSkipCode } from "../../e2e-skip/types";

const PR_OPENED = "https://github.com/o/r/pull/1";
const PR_BRANCH = "https://github.com/o/r/pull/2";
const DECLARED_SKIP = { code: E2eSkipCode.NoWebSurface, detail: "a CLI with no web app" };

function stateWith(overrides: Partial<GuardrailState> = {}): GuardrailState {
  return { sessionId: "s", prsHandled: [], e2eRun: true, ...overrides };
}

function skippedSessionWith(overrides: Partial<GuardrailState> = {}): GuardrailState {
  return stateWith({ e2eRun: false, e2eSkipped: true, e2eSkipDeclaration: DECLARED_SKIP, ...overrides });
}

function lookup(
  branchPrUrl: string | null,
  carrying: string[] = [],
  unreachable: string[] = [],
  carryingSkipRecord: string[] = [],
): PrWalkthroughLookup {
  return {
    branchPrUrl: () => branchPrUrl,
    prCarriesWalkthrough: (prUrl, acceptsSkip) =>
      carrying.includes(prUrl) || unreachable.includes(prUrl) || (acceptsSkip && carryingSkipRecord.includes(prUrl)),
  };
}

describe("an accepted E2E skip owes the PR its record", () => {
  it("arms the gate on the skip alone, and disarms once every PR carries the record", () => {
    expect(isWalkthroughGateArmed(skippedSessionWith())).toBe(true);
    expect(isWalkthroughGateArmed(skippedSessionWith({ e2eSkipSettledOnPrs: true }))).toBe(false);
    expect(isWalkthroughGateArmed(skippedSessionWith({ walkthroughSkipped: true }))).toBe(false);
  });

  it("keeps a run's walkthrough owed even after the skip's record was settled", () => {
    expect(isWalkthroughGateArmed(skippedSessionWith({ e2eRun: true, e2eSkipSettledOnPrs: true }))).toBe(true);
  });

  it("lets the skip's record discharge a PR only when no run happened", () => {
    const skipRecordLookup = lookup(null, [], [], [PR_OPENED]);
    expect(scanForOwedWalkthroughs(skippedSessionWith({ prsHandled: [PR_OPENED] }), skipRecordLookup).verified).toEqual([PR_OPENED]);
    expect(scanForOwedWalkthroughs(stateWith({ prsHandled: [PR_OPENED] }), skipRecordLookup).owed).toEqual([PR_OPENED]);
  });

  it("blocks while a PR still shows the placeholder", () => {
    const decision = walkthroughGateDecision(skippedSessionWith({ prsHandled: [PR_OPENED] }), [PR_OPENED]);
    expect(decision.action).toBe(WalkthroughGateAction.Block);
  });
});

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

  it("stays quiet once every PR in play was verified carrying one", () => {
    const decision = walkthroughGateDecision(stateWith({ walkthroughsVerified: true }), [PR_OPENED]);
    expect(decision.action).toBe(WalkthroughGateAction.None);
  });

  it("still blocks for a second PR after a walkthrough was posted to the first", () => {
    const state = stateWith({ prsHandled: [PR_OPENED, PR_BRANCH], walkthroughPostedAt: 5 });
    expect(walkthroughGateDecision(state, [PR_BRANCH]).action).toBe(WalkthroughGateAction.Block);
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

describe("isWalkthroughGateArmed", () => {
  it("arms once an acceptance run happened and nothing settled the walkthrough", () => {
    expect(isWalkthroughGateArmed(stateWith())).toBe(true);
  });

  it("stays disarmed without an acceptance run, or once every PR was verified or a skip declared", () => {
    expect(isWalkthroughGateArmed(stateWith({ e2eRun: false }))).toBe(false);
    expect(isWalkthroughGateArmed(stateWith({ walkthroughsVerified: true }))).toBe(false);
    expect(isWalkthroughGateArmed(stateWith({ walkthroughSkipped: true }))).toBe(false);
  });

  it("stays armed after a post — the post settles one PR, not every PR in play", () => {
    expect(isWalkthroughGateArmed(stateWith({ walkthroughPostedAt: 5 }))).toBe(true);
  });
});

describe("withoutPostedPrs", () => {
  it("sets aside only the PRs this session was seen posting to", () => {
    const state = stateWith({ walkthroughPostedPrUrls: [PR_OPENED] });
    expect(withoutPostedPrs([PR_OPENED, PR_BRANCH], state)).toEqual([PR_BRANCH]);
    expect(withoutPostedPrs([PR_OPENED, PR_BRANCH], stateWith())).toEqual([PR_OPENED, PR_BRANCH]);
  });
});

describe("applyPrOpenedToWalkthroughs", () => {
  it("re-arms the check when a PR opens after every earlier one was verified", () => {
    const verified = stateWith({ walkthroughsVerified: true });
    expect(isWalkthroughGateArmed(applyPrOpenedToWalkthroughs(verified))).toBe(true);
  });

  it("returns the same reference when nothing was verified", () => {
    const unverified = stateWith();
    expect(applyPrOpenedToWalkthroughs(unverified)).toBe(unverified);
  });
});

describe("isWalkthroughScanCurrent", () => {
  const scanOf = (prsHandled: string[], startedAt?: number) => ({
    prsHandled: prsHandled,
    owed: [],
    verified: [],
    startedAt: startedAt,
  });

  it("rejects a scan begun before the last walkthrough post, which may have settled a PR it found owed", () => {
    const state = stateWith({ prsHandled: [PR_OPENED], walkthroughPostedAt: 10 });
    expect(isWalkthroughScanCurrent(scanOf([PR_OPENED], 9), state)).toBe(false);
    expect(isWalkthroughScanCurrent(scanOf([PR_OPENED]), state)).toBe(false);
  });

  it("accepts a scan begun after the last walkthrough post", () => {
    const state = stateWith({ prsHandled: [PR_OPENED], walkthroughPostedAt: 10 });
    expect(isWalkthroughScanCurrent(scanOf([PR_OPENED], 11), state)).toBe(true);
  });

  it("accepts a scan run for the same handled PRs, in any order", () => {
    const state = stateWith({ prsHandled: [PR_OPENED, PR_BRANCH] });
    expect(isWalkthroughScanCurrent(scanOf([PR_BRANCH, PR_OPENED]), state)).toBe(true);
  });

  it("rejects a scan from before a PR was opened", () => {
    expect(isWalkthroughScanCurrent(scanOf([]), stateWith({ prsHandled: [PR_OPENED] }))).toBe(false);
  });

  it("rejects a scan that covered a PR the state no longer holds", () => {
    expect(isWalkthroughScanCurrent(scanOf([PR_OPENED, PR_BRANCH]), stateWith({ prsHandled: [PR_OPENED] }))).toBe(false);
  });
});
