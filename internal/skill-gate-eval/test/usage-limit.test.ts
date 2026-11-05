import { describe, expect, it } from "vitest";

import { NO_CONCLUSIVE_RUNS_REASON } from "../src/constants.js";
import { formatNoResultNote, summarizeJudgedReps } from "../src/scenario-report.js";
import { usageLimitErrorFromResult, usageLimitVerdict } from "../src/usage-limit.js";

const WEEKLY_LIMIT = "You've hit your weekly limit · resets Nov 10, 12am (UTC)";

describe("usageLimitErrorFromResult", () => {
  it("turns an error result naming a usage limit into an error", () => {
    const usageLimitError = usageLimitErrorFromResult({ type: "result", is_error: true, result: WEEKLY_LIMIT });
    expect(usageLimitError?.message).toContain("hit your weekly limit");
  });

  it("leaves any other result alone", () => {
    expect(usageLimitErrorFromResult({ type: "result", is_error: true, result: "Invalid API key" })).toBeNull();
    expect(usageLimitErrorFromResult({ type: "result", is_error: false, result: WEEKLY_LIMIT })).toBeNull();
    expect(usageLimitErrorFromResult(null)).toBeNull();
  });
});

describe("usageLimitVerdict", () => {
  it("makes a usage-limit error a no-result verdict with an empty trace", () => {
    expect(usageLimitVerdict("s", new Error(WEEKLY_LIMIT))).toMatchObject({
      scenario: "s",
      pass: false,
      isInconclusive: true,
      trace: { mcpCalls: [], askQuestions: [] },
    });
  });

  it("rethrows any other error untouched", () => {
    const sdkFault = new Error("Claude Code process exited with code 1");
    expect(() => usageLimitVerdict("s", sdkFault)).toThrow(sdkFault);
  });
});

describe("summarizeJudgedReps", () => {
  const passing = { pass: true, reasons: [] };
  const failing = { pass: false, reasons: ["gate never fired"] };
  const stopped = { pass: false, reasons: ["run aborted by SDK error"], isInconclusive: true };

  it("judges a scenario on its conclusive reps and drops a stopped rep's reasons", () => {
    expect(summarizeJudgedReps("s", [passing, passing, stopped], 0.8)).toEqual({
      name: "s",
      runs: 2,
      passes: 2,
      passRate: 1,
      passed: true,
      inconclusiveRuns: 1,
      failureReasons: [],
    });
  });

  it("still fails a scenario its conclusive reps fail", () => {
    expect(summarizeJudgedReps("s", [passing, failing, stopped], 0.8)).toMatchObject({
      passRate: 0.5,
      passed: false,
      failureReasons: ["gate never fired"],
    });
  });

  it("fails a scenario with no conclusive rep and says why", () => {
    expect(summarizeJudgedReps("s", [stopped, stopped], 0.8)).toMatchObject({
      runs: 0,
      passRate: 0,
      passed: false,
      inconclusiveRuns: 2,
      failureReasons: [NO_CONCLUSIVE_RUNS_REASON],
    });
  });
});

describe("formatNoResultNote", () => {
  it("names the stopped reps, and says nothing when there are none", () => {
    expect(formatNoResultNote({ inconclusiveRuns: 2 })).toBe(", 2 no result (usage limit)");
    expect(formatNoResultNote({ inconclusiveRuns: 0 })).toBe("");
  });
});
