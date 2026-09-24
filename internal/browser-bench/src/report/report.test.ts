import { describe, expect, it } from "vitest";
import { BenchmarkOutcome, type BenchmarkTask, type TaskResult } from "../domain/types";
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

  it("keeps bot-defence blocks out of the denominator and gives them their own line", () => {
    const markdown = renderReport([
      result("a", BenchmarkOutcome.Pass),
      result("b", BenchmarkOutcome.Fail),
      result("c", BenchmarkOutcome.Blocked),
      result("d", BenchmarkOutcome.Blocked),
    ]);

    expect(markdown).toContain("50.0%");
    expect(markdown).toContain("scored 2");
    expect(markdown).toContain("**Blocked by bot defence:** 2");
  });

  it("still prints the blocked line at zero, so a clean run says so rather than staying silent", () => {
    expect(renderReport([result("a", BenchmarkOutcome.Pass)])).toContain(
      "**Blocked by bot defence:** 0",
    );
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

describe("step budget disclosure", () => {
  const result = {
    taskId: "T--0",
    outcome: BenchmarkOutcome.Pass,
    finalAnswer: "a",
    studioStatus: "success",
    stepCount: 3,
    durationMs: 10,
    tokensUsed: 5,
    trajectoryDir: "d",
  };

  it("states the step budget the run used", () => {
    // A pass rate is only comparable to a published one at the same budget, so
    // the number and the budget that produced it travel together.
    expect(renderReport([result], { maxSteps: 15 })).toMatch(/step budget.*15/i);
  });

  it("marks a raised budget as a deviation rather than leaving it to a footnote", () => {
    const rendered = renderReport([result], { maxSteps: 30 });

    expect(rendered).toMatch(/30/);
    expect(rendered).toMatch(/not comparable|deviat/i);
  });
});

describe("past-dated instruction disclosure", () => {
  const task = (taskId: string, instruction: string): BenchmarkTask => ({
    taskId: taskId,
    siteName: "Booking",
    instruction: instruction,
    startUrl: "https://example.test",
  });

  const tasks = [
    task("stale", "a stay from March 20-27, 2024"),
    task("current", "a stay from March 20-27"),
  ];

  it("names how many instructions pin a year already past", () => {
    const rendered = renderReport(
      [result("stale", BenchmarkOutcome.Fail), result("current", BenchmarkOutcome.Pass)],
      { tasks: tasks, runYear: 2026 },
    );

    expect(rendered).toContain("**Past-dated instructions:** 1");
  });

  it("carries the rate without them on the same line as the count", () => {
    // A caveat that lives only in the prose around the number is one that gets
    // dropped the first time someone quotes the number.
    const rendered = renderReport(
      [result("stale", BenchmarkOutcome.Fail), result("current", BenchmarkOutcome.Pass)],
      { tasks: tasks, runYear: 2026 },
    );

    expect(rendered).toMatch(/Past-dated instructions:\*\* 1.*100\.0%/);
  });

  it("marks the affected row with the year rather than dropping it from the table", () => {
    const rendered = renderReport([result("stale", BenchmarkOutcome.Fail)], {
      tasks: tasks,
      runYear: 2026,
    });

    expect(rendered).toMatch(/\| stale \|.*\| 2024 \|/);
  });

  it("still prints the line at zero, so a clean slice says so", () => {
    expect(renderReport([result("current", BenchmarkOutcome.Pass)], { tasks: tasks })).toContain(
      "**Past-dated instructions:** 0",
    );
  });
});
