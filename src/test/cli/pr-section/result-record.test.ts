import { describe, it, expect } from "vitest";

import { UNPASSED_DETAIL_MAX_CHARS } from "../../../e2e-result/constants";
import { UnpassedCaseStatus } from "../../../e2e-result/types";
import { buildE2eResultRecord } from "../../../cli/pr-section/result-record";
import type { TestResult } from "../../../cli/pr-section/types";

const passed: TestResult = {
  name: "Login",
  testCaseId: "tc-1",
  runId: "run-1",
  viewUrl: "https://www.muggle-ai.com/run/1",
  status: "passed",
  steps: [],
};

const failed: TestResult = {
  name: "Checkout",
  testCaseId: "tc-2",
  runId: "run-2",
  viewUrl: "https://www.muggle-ai.com/run/2",
  status: "failed",
  steps: [
    { stepIndex: 10, action: "Open cart", screenshotUrl: "https://cdn/0.png" },
    { stepIndex: 11, action: "Pay", screenshotUrl: "https://cdn/1.png" },
  ],
  failureStepIndex: 11,
  error: "Pay button\n  disabled",
};

const inconclusive: TestResult = {
  name: "Search",
  testCaseId: "tc-3",
  runId: "run-3",
  viewUrl: "https://www.muggle-ai.com/run/3",
  status: "inconclusive",
  steps: [],
  reason: "x".repeat(UNPASSED_DETAIL_MAX_CHARS + 50),
};

describe("buildE2eResultRecord", () => {
  it("counts every case and keeps only the failed and inconclusive ones, in order", () => {
    const record = buildE2eResultRecord([passed, failed, inconclusive]);
    expect(record.total).toBe(3);
    expect(record.passed).toBe(1);
    expect(record.unpassed.map((c) => [c.testCaseId, c.status])).toEqual([
      ["tc-2", UnpassedCaseStatus.Failed],
      ["tc-3", UnpassedCaseStatus.Inconclusive],
    ]);
  });

  it("numbers the failing step by its place in the run, flattening the error to one line", () => {
    const [unpassed] = buildE2eResultRecord([failed]).unpassed;
    expect(unpassed.failedStep).toBe(2);
    expect(unpassed.detail).toBe("Pay button disabled");
    expect(unpassed.viewUrl).toBe("https://www.muggle-ai.com/run/2");
  });

  it("cuts a long reason to the per-case budget and leaves no step on an inconclusive case", () => {
    const [unpassed] = buildE2eResultRecord([inconclusive]).unpassed;
    expect(unpassed.detail).toHaveLength(UNPASSED_DETAIL_MAX_CHARS);
    expect(unpassed.detail.endsWith("…")).toBe(true);
    expect(unpassed.failedStep).toBeUndefined();
  });

  it("reports an all-passed run with nothing unpassed", () => {
    expect(buildE2eResultRecord([passed])).toEqual({ total: 1, passed: 1, unpassed: [] });
  });
});
