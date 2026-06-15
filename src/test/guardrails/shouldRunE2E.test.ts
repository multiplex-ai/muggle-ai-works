import { describe, it, expect } from "vitest";
import { shouldRunE2E, e2eGateDecision, MAX_E2E_BLOCKS } from "../../guardrails/shouldRunE2E";

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
});

describe("e2eGateDecision", () => {
  const green = { sessionId: "s", prsHandled: [], unitTestsGreen: true };

  it("does nothing when no E2E is owed", () => {
    expect(e2eGateDecision({ ...green, e2eRun: true }).action).toBe("none");
    expect(e2eGateDecision({ sessionId: "s", prsHandled: [] }).action).toBe("none");
  });

  it("blocks and increments the count on the first owed stop", () => {
    expect(e2eGateDecision(green)).toEqual({ action: "block", blockCount: 1 });
    expect(e2eGateDecision({ ...green, e2eBlockCount: 2 })).toEqual({ action: "block", blockCount: 3 });
  });

  it("releases once it has blocked MAX_E2E_BLOCKS times", () => {
    const d = e2eGateDecision({ ...green, e2eBlockCount: MAX_E2E_BLOCKS });
    expect(d.action).toBe("release");
    expect(d.blockCount).toBe(MAX_E2E_BLOCKS);
  });

  it("a recorded E2E run wins even after blocks", () => {
    expect(e2eGateDecision({ ...green, e2eRun: true, e2eBlockCount: 2 }).action).toBe("none");
  });
});
