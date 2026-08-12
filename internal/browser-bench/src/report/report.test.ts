import { describe, expect, it } from "vitest";
import { BenchmarkOutcome, type TaskResult } from "../domain/types";
import { renderReport } from "./report";

const result = (taskId: string, outcome: BenchmarkOutcome): TaskResult => ({
  taskId: taskId,
  outcome: outcome,
  finalAnswer: "",
  studioStatus: "success",
  stepCount: 3,
  durationMs: 1000,
  tokensUsed: 500,
  trajectoryDir: "/tmp",
});

describe("renderReport", () => {
  it("excludes infrastructure errors from the pass-rate denominator", () => {
    const markdown = renderReport([
      result("a", BenchmarkOutcome.Pass),
      result("b", BenchmarkOutcome.Fail),
      result("c", BenchmarkOutcome.Error),
    ]);

    expect(markdown).toContain("50.0%");
    expect(markdown).toContain("scored 2");
    expect(markdown).toContain("infrastructure errors 1");
  });

  it("reports 0.0% rather than dividing by zero when every task errored", () => {
    const markdown = renderReport([result("a", BenchmarkOutcome.Error)]);

    expect(markdown).toContain("0.0%");
    expect(markdown).toContain("scored 0");
  });

  it("totals tokens across every attempt, including errored ones", () => {
    const markdown = renderReport([
      result("a", BenchmarkOutcome.Pass),
      result("b", BenchmarkOutcome.Error),
    ]);

    expect(markdown).toContain("**Total tokens:** 1000");
  });
});
