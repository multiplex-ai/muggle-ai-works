import * as path from "node:path";

import { BROWSER_PROFILES_DIRNAME, TRAJECTORIES_DIRNAME } from "../domain/constants";
import { type BenchmarkTask, type TaskResult } from "../domain/types";
import { STUDIO_RESULT_FILENAME, STUDIO_TASK_FILENAME } from "./constants";
import { buildStudioTaskFile } from "./studio-invocation";
import { parseStudioResult, toTaskResult } from "./studio-result";
import { type SpawnStudio, type StudioExitReport, type StudioProcess, type TaskFileSystem } from "./types";

/** WebVoyager task ids carry spaces ("BBC News--0"); a directory name should not. */
const toPathSegment = (taskId: string): string => taskId.replace(/[^A-Za-z0-9._-]+/g, "_");

const awaitExitWithinBudgetAsync = async ({
  studioProcess,
  taskId,
  taskTimeoutMs,
}: {
  studioProcess: StudioProcess;
  taskId: string;
  taskTimeoutMs: number;
}): Promise<StudioExitReport> => {
  let expiryHandle: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<undefined>((resolve) => {
    expiryHandle = setTimeout(() => resolve(undefined), taskTimeoutMs);
  });

  try {
    const exitReport = await Promise.race([studioProcess.exitReport, expiry]);
    if (exitReport !== undefined) return exitReport;

    studioProcess.kill();
    // The killed process still settles its own promise; nobody is left to await it.
    void studioProcess.exitReport.catch(() => undefined);
    throw new Error(`Task ${taskId} exceeded its ${taskTimeoutMs} ms budget; studio was killed.`);
  } finally {
    clearTimeout(expiryHandle);
  }
};

/**
 * Runs one benchmark task as a single studio process.
 *
 * The task gets an empty trajectory directory and an empty browser profile, so
 * neither a previous attempt's artifacts nor its logged-in state can reach it.
 * Anything short of "studio exited 0 and wrote a readable result" throws, which
 * is how the orchestrator learns to record an infrastructure error rather than
 * a capability failure.
 *
 * Output shape: `{ taskId: "Allrecipes--0", outcome: "pass", studioStatus: "success",
 * stepCount: 7, durationMs: 41230, tokensUsed: 0, trajectoryDir: "…" }`
 *
 * @throws When studio cannot be started, outlives `taskTimeoutMs`, exits
 * non-zero, or leaves no readable result file behind.
 */
export const runStudioTaskAsync = async ({
  task,
  outDir,
  studioBinPath,
  authFilePath,
  maxSteps,
  taskTimeoutMs,
  spawnStudio,
  fileSystem,
}: {
  task: BenchmarkTask;
  outDir: string;
  studioBinPath: string;
  authFilePath: string;
  maxSteps: number;
  taskTimeoutMs: number;
  spawnStudio: SpawnStudio;
  fileSystem: TaskFileSystem;
}): Promise<TaskResult> => {
  const pathSegment = toPathSegment(task.taskId);
  const trajectoryDir = path.join(outDir, TRAJECTORIES_DIRNAME, pathSegment);
  const browserProfileDir = path.join(outDir, BROWSER_PROFILES_DIRNAME, pathSegment);
  const taskFilePath = path.join(trajectoryDir, STUDIO_TASK_FILENAME);
  const resultFilePath = path.join(trajectoryDir, STUDIO_RESULT_FILENAME);

  await fileSystem.recreateDirAsync(trajectoryDir);
  await fileSystem.recreateDirAsync(browserProfileDir);

  const studioTaskFile = buildStudioTaskFile({
    task: task,
    maxSteps: maxSteps,
    trajectoryDir: trajectoryDir,
    resultFilePath: resultFilePath,
  });
  await fileSystem.writeTextAsync(taskFilePath, `${JSON.stringify(studioTaskFile, null, 2)}\n`);

  const studioProcess = spawnStudio({
    studioBinPath: studioBinPath,
    authFilePath: authFilePath,
    taskFilePath: taskFilePath,
    resultFilePath: resultFilePath,
    browserProfileDir: browserProfileDir,
  });

  const exitReport = await awaitExitWithinBudgetAsync({
    studioProcess: studioProcess,
    taskId: task.taskId,
    taskTimeoutMs: taskTimeoutMs,
  });

  if (exitReport.exitCode !== 0) {
    throw new Error(
      `Studio exited ${exitReport.exitCode ?? "on a signal"} for task ${task.taskId}. ${exitReport.stderrTail}`.trim(),
    );
  }

  let resultFileContent: string;
  try {
    resultFileContent = await fileSystem.readTextAsync(resultFilePath);
  } catch {
    throw new Error(
      `Studio exited 0 for task ${task.taskId} but wrote no result file at ${resultFilePath}.`,
    );
  }

  return toTaskResult(parseStudioResult({ jsonContent: resultFileContent, expectedTaskId: task.taskId }));
};
