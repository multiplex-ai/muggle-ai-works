import { BenchmarkOutcome, type BenchmarkTask, type TaskResult } from "../domain/types";

/**
 * Runs every task through `runTaskAsync`, at most `concurrency` at a time.
 *
 * A task that throws is recorded as `BenchmarkOutcome.Error` and excluded from
 * the pass-rate — infrastructure noise must never read as a capability failure.
 * Results come back in task order regardless of completion order, so a report
 * built from them is stable across runs.
 *
 * Output shape: `[{ taskId: "Allrecipes--3", outcome: "pass", stepCount: 4, … }]`
 */
export const runBatchAsync = async ({
  tasks,
  runTaskAsync,
  concurrency,
}: {
  tasks: BenchmarkTask[];
  runTaskAsync: (task: BenchmarkTask) => Promise<TaskResult>;
  concurrency: number;
}): Promise<TaskResult[]> => {
  const results: TaskResult[] = new Array<TaskResult>(tasks.length);
  let nextIndex = 0;

  const workerAsync = async (): Promise<void> => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) return;

      const task = tasks[index];
      const startedAt = Date.now();
      try {
        results[index] = await runTaskAsync(task);
      } catch (error) {
        results[index] = {
          taskId: task.taskId,
          outcome: BenchmarkOutcome.Error,
          finalAnswer: "",
          studioStatus: "none",
          stepCount: 0,
          durationMs: Date.now() - startedAt,
          tokensUsed: 0,
          errorReason: error instanceof Error ? error.message : String(error),
          trajectoryDir: "",
        };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => workerAsync()),
  );

  return results;
};
