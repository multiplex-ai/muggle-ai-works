import { describe, expect, it } from "vitest";
import { BenchmarkOutcome, ModelSource, type TaskResult } from "../domain/types";
import { classifyFailure } from "./failure-class";
import { parseCompareArgs } from "./compare-args";
import { renderSourceParReport } from "./render-par-report";
import { evaluateSourcePar } from "./source-par";

const result = ({
  taskId,
  outcome = BenchmarkOutcome.Pass,
  durationMs = 10000,
  stepCount = 5,
  modelSource,
  errorReason,
}: {
  taskId: string;
  outcome?: BenchmarkOutcome;
  durationMs?: number;
  stepCount?: number;
  modelSource?: ModelSource;
  errorReason?: string;
}): TaskResult => ({
  taskId: taskId,
  outcome: outcome,
  finalAnswer: "",
  studioStatus: "success",
  stepCount: stepCount,
  durationMs: durationMs,
  tokensUsed: 0,
  trajectoryDir: "/tmp",
  modelSource: modelSource,
  errorReason: errorReason,
});

const batch = (modelSource: ModelSource, durationMs: number, outcomes: BenchmarkOutcome[]): TaskResult[] =>
  outcomes.map((outcome, index) =>
    result({ taskId: `task-${index}`, outcome: outcome, durationMs: durationMs, modelSource: modelSource }),
  );

const tenTasks = (failCount: number): BenchmarkOutcome[] =>
  Array.from({ length: 10 }, (_, index) => (index < failCount ? BenchmarkOutcome.Fail : BenchmarkOutcome.Pass));

describe("classifyFailure", () => {
  it("names judged failures and blocks by outcome, and errors by kind", () => {
    expect(classifyFailure(result({ taskId: "a" }))).toBeUndefined();
    expect(classifyFailure(result({ taskId: "a", outcome: BenchmarkOutcome.Fail }))).toBe("fail");
    expect(classifyFailure(result({ taskId: "a", outcome: BenchmarkOutcome.Blocked }))).toBe("blocked");
    const errorOf = (errorReason: string) =>
      classifyFailure(result({ taskId: "a", outcome: BenchmarkOutcome.Error, errorReason: errorReason }));
    expect(errorOf("Task a exceeded its 600000 ms budget; studio was killed.")).toBe("error:timeout");
    expect(errorOf("Studio exited 3 for task a; full output at x.")).toBe("error:exit-3");
    expect(errorOf("Studio exited on a signal for task a")).toBe("error:killed");
    expect(errorOf("Studio exited 0 for task a but wrote no result file at x.")).toBe("error:no-result");
    expect(errorOf("Studio ran task a on model source anthropic but the batch configured claude-code")).toBe(
      "error:source-mismatch",
    );
    expect(errorOf("judge unreachable")).toBe("error:other");
  });
});

describe("evaluateSourcePar", () => {
  it("is on par within every bar", () => {
    const verdict = evaluateSourcePar({
      baselineResults: batch(ModelSource.Anthropic, 10000, tenTasks(2)),
      candidateResults: batch(ModelSource.ClaudeCode, 11500, tenTasks(2)),
    });

    expect(verdict.isPar).toBe(true);
    expect(verdict.stepTimeRatio).toBeCloseTo(1.15);
    expect(verdict.passRateDeltaPoints).toBe(0);
    expect(verdict.missedBars).toEqual([]);
  });

  it("misses the step-time bar above 1.2x", () => {
    const verdict = evaluateSourcePar({
      baselineResults: batch(ModelSource.Anthropic, 10000, tenTasks(2)),
      candidateResults: batch(ModelSource.ClaudeCode, 13000, tenTasks(2)),
    });

    expect(verdict.isPar).toBe(false);
    expect(verdict.missedBars[0]).toMatch(/1\.30× the baseline's, above 1\.2×/);
  });

  it("misses the pass-rate bar more than two points below, but not above", () => {
    const below = evaluateSourcePar({
      baselineResults: batch(ModelSource.Anthropic, 10000, tenTasks(2)),
      candidateResults: batch(ModelSource.ClaudeCode, 10000, tenTasks(3)),
    });
    const above = evaluateSourcePar({
      baselineResults: batch(ModelSource.Anthropic, 10000, tenTasks(3)),
      candidateResults: batch(ModelSource.ClaudeCode, 10000, tenTasks(0)),
    });

    expect(below.isPar).toBe(false);
    expect(below.passRateDeltaPoints).toBe(-10);
    expect(above.isPar).toBe(true);
  });

  it("misses the failure-class bar when the candidate fails in a new way", () => {
    const candidateResults = batch(ModelSource.ClaudeCode, 10000, tenTasks(0));
    candidateResults[0] = result({
      taskId: "task-0",
      outcome: BenchmarkOutcome.Error,
      errorReason: "Studio exited 7 for task task-0",
    });

    const verdict = evaluateSourcePar({
      baselineResults: batch(ModelSource.Anthropic, 10000, tenTasks(0)),
      candidateResults: candidateResults,
    });

    expect(verdict.newFailureClasses).toEqual(["error:exit-7"]);
    expect(verdict.isPar).toBe(false);
  });

  it("refuses batches that ran different tasks, lack a source, or share one", () => {
    expect(() =>
      evaluateSourcePar({
        baselineResults: batch(ModelSource.Anthropic, 1, tenTasks(0)),
        candidateResults: batch(ModelSource.ClaudeCode, 1, tenTasks(0)).slice(1),
      }),
    ).toThrow(/different tasks/);
    expect(() =>
      evaluateSourcePar({
        baselineResults: [result({ taskId: "a" })],
        candidateResults: [result({ taskId: "a", modelSource: ModelSource.ClaudeCode })],
      }),
    ).toThrow(/no recorded model source/);
    expect(() =>
      evaluateSourcePar({
        baselineResults: batch(ModelSource.ClaudeCode, 1, tenTasks(0)),
        candidateResults: batch(ModelSource.ClaudeCode, 1, tenTasks(0)),
      }),
    ).toThrow(/same source|Both batches ran on claude-code/);
  });
});

describe("renderSourceParReport", () => {
  it("leads with the verdict and lists the missed bars", () => {
    const markdown = renderSourceParReport(
      evaluateSourcePar({
        baselineResults: batch(ModelSource.Anthropic, 10000, tenTasks(2)),
        candidateResults: batch(ModelSource.ClaudeCode, 13000, tenTasks(2)),
      }),
    );

    expect(markdown).toContain("**Verdict:** not on par — claude-code against anthropic over 10 task(s)");
    expect(markdown).toContain("- Median step time 1.30×");
    expect(markdown).toContain("| candidate | claude-code | 10 | 80.0% | 2600 ms | fail |");
  });
});

describe("parseCompareArgs", () => {
  it("reads both batch directories", () => {
    expect(parseCompareArgs(["--baseline", "a", "--candidate", "b"])).toEqual({ baselineDir: "a", candidateDir: "b" });
  });

  it("requires both", () => {
    expect(() => parseCompareArgs(["--baseline", "a"])).toThrow(/required/);
  });

  it("rejects an unknown flag", () => {
    expect(() => parseCompareArgs(["--other", "a"])).toThrow(/Unknown flag/);
  });
});
