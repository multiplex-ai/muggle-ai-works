import { describe, it, expect } from "vitest";
import { shouldRunE2E } from "../../guardrails/shouldRunE2E";

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
