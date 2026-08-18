import { type BenchmarkTask, type TaskResult } from "../domain/types";

/** Serializes one result as a `partial.jsonl` line, trailing newline included. */
export const serializePartialLogEntry = (result: TaskResult): string => `${JSON.stringify(result)}\n`;

/**
 * Reads the results a previous run already recorded.
 *
 * Unparseable lines are skipped rather than thrown on: a run killed mid-append
 * leaves a truncated final line, and refusing to read it would throw away the
 * whole batch the log exists to protect.
 *
 * Output shape: `[{ taskId: "Allrecipes--0", outcome: "pass", stepCount: 7, … }]`
 */
export const parsePartialLog = (logContent: string): TaskResult[] => {
  const results: TaskResult[] = [];

  logContent.split("\n").forEach((rawLine) => {
    const line = rawLine.trim();
    if (line === "") return;

    try {
      results.push(JSON.parse(line) as TaskResult);
    } catch {
      return;
    }
  });

  return results;
};

/**
 * Drops the tasks a previous run already recorded, leaving what `--resume` still owes.
 *
 * Output shape: `[{ taskId: "Amazon--0", siteName: "Amazon", instruction: "…", startUrl: "…" }]`
 */
export const selectPendingTasks = ({
  tasks,
  completedResults,
}: {
  tasks: BenchmarkTask[];
  completedResults: TaskResult[];
}): BenchmarkTask[] => {
  const completedTaskIds = new Set(completedResults.map((result) => result.taskId));
  return tasks.filter((task) => !completedTaskIds.has(task.taskId));
};

/**
 * Puts resumed and freshly-run results back into task order, so a batch that
 * resumed reports identically to one that ran start to finish. Results with no
 * matching task are dropped — a stale log must not add rows to the report.
 *
 * Output shape: `[{ taskId: "Allrecipes--0", … }, { taskId: "Amazon--0", … }]`
 */
export const mergeResultsInTaskOrder = ({
  tasks,
  results,
}: {
  tasks: BenchmarkTask[];
  results: TaskResult[];
}): TaskResult[] => {
  const resultsByTaskId = new Map(results.map((result) => [result.taskId, result]));

  return tasks
    .map((task) => resultsByTaskId.get(task.taskId))
    .filter((result): result is TaskResult => result !== undefined);
};
