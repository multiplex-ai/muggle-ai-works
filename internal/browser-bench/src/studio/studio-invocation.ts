import { type BenchmarkTask } from "../domain/types";
import { BENCHMARK_TASK_FLAG, STUDIO_RUN_MODE } from "./constants";
import { type StudioInvocation, type StudioTaskFile } from "./types";

/**
 * Builds the `task.json` payload for one attempt.
 *
 * Output shape: `{ taskId: "Allrecipes--0", instruction: "Provide a recipe…",
 * startUrl: "https://www.allrecipes.com/", maxSteps: 15,
 * trajectoryDir: "…/trajectories/Allrecipes--0",
 * outputFilePath: "…/trajectories/Allrecipes--0/result.json" }`
 */
export const buildStudioTaskFile = ({
  task,
  maxSteps,
  trajectoryDir,
  resultFilePath,
}: {
  task: BenchmarkTask;
  maxSteps: number;
  trajectoryDir: string;
  resultFilePath: string;
}): StudioTaskFile => ({
  taskId: task.taskId,
  instruction: task.instruction,
  startUrl: task.startUrl,
  maxSteps: maxSteps,
  trajectoryDir: trajectoryDir,
  outputFilePath: resultFilePath,
});

/**
 * Builds studio's argument list. The contract is fixed on both sides — studio
 * reads four positional slots — mode, script, mutation params, auth file —
 * before it scans for flags. The benchmark has no script or mutation params, so
 * those slots are empty strings, which studio normalises to undefined. Pinned
 * here rather than assembled inline at the spawn site.
 *
 * Output shape: `["explore", "", "", "…/studio-auth.json", "--benchmark-task", "…/task.json"]`
 */
export const buildStudioArgv = (invocation: StudioInvocation): string[] => [
  STUDIO_RUN_MODE,
  "",
  "",
  invocation.authFilePath,
  BENCHMARK_TASK_FLAG,
  invocation.taskFilePath,
];
