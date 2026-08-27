import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCliArgs } from "./cli/args";
import {
  MAX_STEPS_PER_TASK,
  PARTIAL_LOG_FILENAME,
  REPORT_FILENAME,
  TASK_TIMEOUT_MS,
} from "./domain/constants";
import { BenchmarkOutcome, type TaskResult } from "./domain/types";
import { runBatchAsync } from "./orchestrator/orchestrator";
import {
  mergeResultsInTaskOrder,
  parsePartialLog,
  selectPendingTasks,
  serializePartialLogEntry,
} from "./partial-log/partial-log";
import { renderReport } from "./report/report";
import {
  DEFAULT_STUDIO_BIN,
  MUGGLE_SESSION_PATH_SEGMENTS,
  STUDIO_BIN_ENV_VAR,
} from "./studio/constants";
import {
  removeStudioAuthFile,
  writeStudioAuthFile,
} from "./studio/studio-auth";
import { nodeTaskFileSystem } from "./studio/node-file-system";
import { spawnStudioProcess } from "./studio/node-studio-spawn";
import { runStudioTaskAsync } from "./studio/studio-runner";
import { loadWebVoyagerTasks } from "./task-source/webvoyager-source";

const TOOL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_TASKS_PATH = path.join(
  TOOL_DIR,
  "data",
  "webvoyager-smoke.jsonl",
);
const DEFAULT_OUT_DIR = path.join(TOOL_DIR, "reports");

const mainAsync = async (): Promise<void> => {
  const options = parseCliArgs({
    argv: process.argv.slice(2),
    defaultTasksPath: DEFAULT_TASKS_PATH,
    defaultOutDir: DEFAULT_OUT_DIR,
  });

  const allTasks = loadWebVoyagerTasks(
    fs.readFileSync(options.tasksPath, "utf8"),
  );
  const tasks =
    options.taskLimit === undefined
      ? allTasks
      : allTasks.slice(0, options.taskLimit);

  fs.mkdirSync(options.outDir, { recursive: true });
  const partialLogPath = path.join(options.outDir, PARTIAL_LOG_FILENAME);
  const partialLogExists = fs.existsSync(partialLogPath);

  const resumedResults =
    options.resume && partialLogExists
      ? parsePartialLog(fs.readFileSync(partialLogPath, "utf8"))
      : [];
  if (!options.resume && partialLogExists) fs.rmSync(partialLogPath);

  const appendPartialLogEntry = (result: TaskResult): void =>
    fs.appendFileSync(partialLogPath, serializePartialLogEntry(result), "utf8");

  const pendingTasks = selectPendingTasks({
    tasks: tasks,
    completedResults: resumedResults,
  });
  const studioBinPath = process.env[STUDIO_BIN_ENV_VAR] ?? DEFAULT_STUDIO_BIN;

  // One profile for the whole batch. Studio authenticates with its own client
  // credentials and reads this only for identity, so there is nothing per-task
  // about it — and one short-lived file beats one per task.
  const authFilePath = writeStudioAuthFile(
    path.join(os.homedir(), ...MUGGLE_SESSION_PATH_SEGMENTS),
  );

  process.stdout.write(
    `browser-bench: ${pendingTasks.length} task(s) to run, ${resumedResults.length} resumed, ` +
      `concurrency ${options.concurrency}, studio ${studioBinPath}\n`,
  );

  let freshResults: TaskResult[];
  try {
    freshResults = await runBatchAsync({
      tasks: pendingTasks,
      concurrency: options.concurrency,
      runTaskAsync: async (task) => {
        const taskResult = await runStudioTaskAsync({
          task: task,
          outDir: options.outDir,
          studioBinPath: studioBinPath,
          authFilePath: authFilePath,
          maxSteps: MAX_STEPS_PER_TASK,
          taskTimeoutMs: TASK_TIMEOUT_MS,
          spawnStudio: spawnStudioProcess,
          fileSystem: nodeTaskFileSystem,
        });
        appendPartialLogEntry(taskResult);
        return taskResult;
      },
    });
  } finally {
    removeStudioAuthFile(authFilePath);
  }

  // The orchestrator, not the seam above, builds the record for a task that threw,
  // so error rows reach the log only once the batch hands them back.
  freshResults
    .filter((result) => result.outcome === BenchmarkOutcome.Error)
    .forEach(appendPartialLogEntry);

  const reportPath = path.join(options.outDir, REPORT_FILENAME);
  const orderedResults = mergeResultsInTaskOrder({
    tasks: tasks,
    results: [...resumedResults, ...freshResults],
  });
  fs.writeFileSync(reportPath, `${renderReport(orderedResults)}\n`, "utf8");

  process.stdout.write(`Report: ${reportPath}\n`);
};

mainAsync().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
