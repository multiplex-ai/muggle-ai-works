import { describe, it, expect } from "vitest";
import { shouldRunE2E, e2eGateDecision, E2eGateAction, MAX_E2E_BLOCKS, applyRecordedRun } from "../../guardrails/shouldRunE2E";

describe("shouldRunE2E", () => {
  it("fires when tests green and no e2e yet", () => {
    expect(shouldRunE2E({ sessionId: "s", prsHandled: [], unitTestsGreen: true, e2eRun: false })).toBe(true);
  });
  it("does not fire if e2e already ran", () => {
    expect(shouldRunE2E({ sessionId: "s", prsHandled: [], unitTestsGreen: true, e2eRun: true })).toBe(false);
  });
  it("does not fire if tests never went green", () => {
    expect(shouldRunE2E({ sessionId: "s", prsHandled: [], unitTestsGreen: false })).toBe(false);
  });
  it("does not fire once a skip was recorded", () => {
    expect(shouldRunE2E({ sessionId: "s", prsHandled: [], unitTestsGreen: true, e2eSkipped: true })).toBe(false);
  });
});

describe("e2eGateDecision", () => {
  const green = { sessionId: "s", prsHandled: [], unitTestsGreen: true };

  it("does nothing when no E2E is owed", () => {
    expect(e2eGateDecision({ ...green, e2eRun: true }).action).toBe(E2eGateAction.None);
    expect(e2eGateDecision({ sessionId: "s", prsHandled: [] }).action).toBe(E2eGateAction.None);
  });

  it("blocks and increments the count on the first owed stop", () => {
    expect(e2eGateDecision(green)).toEqual({ action: E2eGateAction.Block, blockCount: 1 });
    expect(e2eGateDecision({ ...green, e2eBlockCount: 2 })).toEqual({ action: E2eGateAction.Block, blockCount: 3 });
  });

  it("releases once it has blocked MAX_E2E_BLOCKS times", () => {
    const d = e2eGateDecision({ ...green, e2eBlockCount: MAX_E2E_BLOCKS });
    expect(d.action).toBe(E2eGateAction.Release);
    expect(d.blockCount).toBe(MAX_E2E_BLOCKS);
  });

  it("a recorded E2E run wins even after blocks", () => {
    expect(e2eGateDecision({ ...green, e2eRun: true, e2eBlockCount: 2 }).action).toBe(E2eGateAction.None);
  });
});

describe("applyRecordedRun", () => {
  const base = { sessionId: "s", prsHandled: [] };

  it("a unit-test pass marks tests green and arms the gate", () => {
    const next = applyRecordedRun(base, { unitTestPassed: true });
    expect(next.unitTestsGreen).toBe(true);
    expect(shouldRunE2E(next)).toBe(true);
  });

  it("an E2E run satisfies the gate", () => {
    const next = applyRecordedRun({ ...base, unitTestsGreen: true }, { e2eRan: true });
    expect(next.e2eRun).toBe(true);
    expect(shouldRunE2E(next)).toBe(false);
  });

  it("re-arms across rounds: a fresh unit pass after a prior E2E re-requires E2E", () => {
    const afterRound1 = { ...base, unitTestsGreen: true, e2eRun: true, e2eBlockCount: 2 };
    expect(shouldRunE2E(afterRound1)).toBe(false);

    const afterRound2Unit = applyRecordedRun(afterRound1, { unitTestPassed: true });
    expect(afterRound2Unit.e2eRun).toBe(false);
    expect(shouldRunE2E(afterRound2Unit)).toBe(true);
  });

  it("a unit-test pass re-arms without rewinding the block counter", () => {
    const blockedTwice = { ...base, unitTestsGreen: true, e2eRun: false, e2eBlockCount: 2 };
    const afterUnitPass = applyRecordedRun(blockedTwice, { unitTestPassed: true });
    expect(afterUnitPass.e2eBlockCount).toBe(2);
    expect(shouldRunE2E(afterUnitPass)).toBe(true);
  });

  it("only a registered E2E run resets the block counter", () => {
    const blockedTwice = { ...base, unitTestsGreen: true, e2eBlockCount: 2 };
    const afterE2E = applyRecordedRun(blockedTwice, { e2eRan: true });
    expect(afterE2E.e2eBlockCount).toBe(0);
    expect(afterE2E.e2eRun).toBe(true);
  });

  it("blocked ×3 then released stays released across interleaved unit-test passes", () => {
    let state = applyRecordedRun(base, { unitTestPassed: true });
    for (let round = 1; round <= MAX_E2E_BLOCKS; round++) {
      const decision = e2eGateDecision(state);
      expect(decision).toEqual({ action: E2eGateAction.Block, blockCount: round });
      state = { ...state, e2eBlockCount: decision.blockCount };
      state = applyRecordedRun(state, { unitTestPassed: true });
    }
    expect(e2eGateDecision(state).action).toBe(E2eGateAction.Release);
    const afterYetAnotherUnitPass = applyRecordedRun(state, { unitTestPassed: true });
    expect(e2eGateDecision(afterYetAnotherUnitPass).action).toBe(E2eGateAction.Release);
  });

  it("a recorded skip satisfies the gate", () => {
    const next = applyRecordedRun({ ...base, unitTestsGreen: true }, { e2eSkipped: true });
    expect(next.e2eSkipped).toBe(true);
    expect(shouldRunE2E(next)).toBe(false);
    expect(e2eGateDecision(next).action).toBe(E2eGateAction.None);
  });

  it("a skip survives a later unit-green re-arm — no re-nagging within the session", () => {
    const skipped = applyRecordedRun({ ...base, unitTestsGreen: true }, { e2eSkipped: true });
    const afterNextUnitPass = applyRecordedRun(skipped, { unitTestPassed: true });
    expect(afterNextUnitPass.e2eSkipped).toBe(true);
    expect(shouldRunE2E(afterNextUnitPass)).toBe(false);
  });

  it("returns the same reference when nothing was recorded", () => {
    expect(applyRecordedRun(base, { unitTestPassed: false, e2eRan: false })).toBe(base);
  });
});
