import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCliArgs } from "./cli/args";
import {
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
  JUDGE_API_KEY_ENV_VAR,
  JUDGE_MAX_RETRIES,
  TRAJECTORY_MANIFEST_FILENAME,
} from "./judge/constants";
import { createClaudeJudgeInvoker } from "./judge/claude-judge";
import { judgeTaskAsync } from "./judge/judge";
import { applyJudgeVerdict, resolveTrajectoryScreenshotPaths } from "./judge/judged-result";
import {
  DEFAULT_STUDIO_BIN,
  STUDIO_BIN_ENV_VAR,
} from "./studio/constants";
import {
  removeStudioAuthFile,
  writeStudioAuthFile,
} from "./studio/studio-auth";
import { nodeTaskFileSystem } from "./studio/node-file-system";
import { resolveBenchmarkSessionPath } from "./studio/benchmark-session";
import { spawnStudioProcess } from "./studio/node-studio-spawn";
import { runStudioTaskAsync } from "./studio/studio-runner";
import { loadWebVoyagerTasks } from "./task-source/webvoyager-source";
import { selectStratifiedSample } from "./task-source/stratified-sample";

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
  // Sampling picks which tasks; --limit then truncates whatever that produced.
  const selectedTasks =
    options.sampleSize === undefined
      ? allTasks
      : selectStratifiedSample({
          tasks: allTasks,
          sampleSize: options.sampleSize,
          seed: options.sampleSeed!,
        });
  const tasks =
    options.taskLimit === undefined
      ? selectedTasks
      : selectedTasks.slice(0, options.taskLimit);

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

  // Checked before the first task rather than at the first verdict: a batch that
  // runs every task and only then finds it cannot score them has spent the whole
  // run to produce nothing.
  if (!process.env[JUDGE_API_KEY_ENV_VAR]) {
    throw new Error(
      `${JUDGE_API_KEY_ENV_VAR} is unset, so no attempt could be scored. ` +
        `Export it before running the benchmark.`,
    );
  }
  // The SDK's default of two retries was not enough: a busy hour returned 529
  // Overloaded past it and cost two tasks their verdict, which excludes them
  // from the denominator. A judge that gives up shrinks the evidence behind the
  // score, so it retries well past the point of politeness.
  const invokeJudgeAsync = createClaudeJudgeInvoker({
    client: new Anthropic({ maxRetries: JUDGE_MAX_RETRIES }),
  });

  // One profile for the whole batch. Studio authenticates with its own client
  // credentials and reads this only for identity, so there is nothing per-task
  // about it — and one short-lived file beats one per task.
  const authFilePath = writeStudioAuthFile(resolveBenchmarkSessionPath(process.env));

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
        const studioTaskResult = await runStudioTaskAsync({
          task: task,
          outDir: options.outDir,
          studioBinPath: studioBinPath,
          authFilePath: authFilePath,
          maxSteps: options.maxSteps,
          taskTimeoutMs: TASK_TIMEOUT_MS,
          spawnStudio: spawnStudioProcess,
          fileSystem: nodeTaskFileSystem,
        });

        const taskResult = applyJudgeVerdict({
          taskResult: studioTaskResult,
          verdict: await judgeTaskAsync({
            instruction: task.instruction,
            finalAnswer: studioTaskResult.finalAnswer,
            screenshotPaths: resolveTrajectoryScreenshotPaths({
              trajectoryDir: studioTaskResult.trajectoryDir,
              manifestContent: fs.readFileSync(
                path.join(studioTaskResult.trajectoryDir, TRAJECTORY_MANIFEST_FILENAME),
                "utf8",
              ),
            }),
            invokeJudgeAsync: invokeJudgeAsync,
          }),
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
  fs.writeFileSync(reportPath, `${renderReport(orderedResults, { maxSteps: options.maxSteps, tasks: tasks })}\n`, "utf8");

  process.stdout.write(`Report: ${reportPath}\n`);
};

mainAsync().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
