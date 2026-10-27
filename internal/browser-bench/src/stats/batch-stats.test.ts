import { describe, expect, it } from "vitest";
import { BenchmarkOutcome, type TaskResult } from "../domain/types";
import { computeMedianStepMs, computePassRate } from "./batch-stats";

const result = (outcome: BenchmarkOutcome, durationMs: number, stepCount: number): TaskResult => ({
  taskId: `${outcome}-${durationMs}`,
  outcome: outcome,
  finalAnswer: "",
  studioStatus: "success",
  stepCount: stepCount,
  durationMs: durationMs,
  tokensUsed: 0,
  trajectoryDir: "/tmp",
});

describe("computePassRate", () => {
  it("scores passes over passes and fails only", () => {
    expect(
      computePassRate([
        result(BenchmarkOutcome.Pass, 1, 1),
        result(BenchmarkOutcome.Fail, 1, 1),
        result(BenchmarkOutcome.Error, 1, 0),
        result(BenchmarkOutcome.Blocked, 1, 1),
      ]),
    ).toBe(50);
  });

  it("is zero with nothing scored", () => {
    expect(computePassRate([result(BenchmarkOutcome.Error, 1, 0)])).toBe(0);
  });
});

describe("computeMedianStepMs", () => {
  it("takes the median of each scored attempt's average step time", () => {
    expect(
      computeMedianStepMs([
        result(BenchmarkOutcome.Pass, 4000, 2),
        result(BenchmarkOutcome.Fail, 9000, 3),
        result(BenchmarkOutcome.Pass, 10000, 2),
        result(BenchmarkOutcome.Error, 600000, 1),
      ]),
    ).toBe(3000);
  });

  it("averages the two middle values for an even count", () => {
    expect(
      computeMedianStepMs([result(BenchmarkOutcome.Pass, 2000, 1), result(BenchmarkOutcome.Pass, 4000, 1)]),
    ).toBe(3000);
  });

  it("is undefined when no scored attempt took a step", () => {
    expect(computeMedianStepMs([result(BenchmarkOutcome.Pass, 100, 0)])).toBeUndefined();
  });
});
