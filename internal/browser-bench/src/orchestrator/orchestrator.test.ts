import { describe, expect, it } from "vitest";
import { BenchmarkOutcome, type BenchmarkTask, type TaskResult } from "../domain/types";
import { runBatchAsync } from "./orchestrator";

const task = (id: string): BenchmarkTask => ({
  taskId: id,
  siteName: "Test",
  instruction: "do it",
  startUrl: "https://example.com",
});

const passResult = (taskId: string): TaskResult => ({
  taskId: taskId,
  outcome: BenchmarkOutcome.Pass,
  finalAnswer: "",
  studioStatus: "success",
  stepCount: 1,
  durationMs: 10,
  tokensUsed: 0,
  trajectoryDir: "/tmp",
});

describe("runBatchAsync", () => {
  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;

    await runBatchAsync({
      tasks: [task("a"), task("b"), task("c"), task("d")],
      concurrency: 2,
      runTaskAsync: async (t) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return passResult(t.taskId);
      },
    });

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("records a thrown task as an infrastructure error, not a failure", async () => {
    const results = await runBatchAsync({
      tasks: [task("a")],
      concurrency: 1,
      runTaskAsync: async () => {
        throw new Error("electron crashed");
      },
    });

    expect(results[0].outcome).toBe(BenchmarkOutcome.Error);
    expect(results[0].errorReason).toContain("electron crashed");
  });

  it("returns results in task order regardless of completion order", async () => {
    const results = await runBatchAsync({
      tasks: [task("slow"), task("fast")],
      concurrency: 2,
      runTaskAsync: async (t) => {
        await new Promise((resolve) => setTimeout(resolve, t.taskId === "slow" ? 30 : 1));
        return passResult(t.taskId);
      },
    });

    expect(results.map((r) => r.taskId)).toEqual(["slow", "fast"]);
  });

  it("runs every task even when one throws", async () => {
    const seen: string[] = [];

    await runBatchAsync({
      tasks: [task("a"), task("b"), task("c")],
      concurrency: 1,
      runTaskAsync: async (t) => {
        seen.push(t.taskId);
        if (t.taskId === "b") throw new Error("boom");
        return passResult(t.taskId);
      },
    });

    expect(seen).toEqual(["a", "b", "c"]);
  });
});
