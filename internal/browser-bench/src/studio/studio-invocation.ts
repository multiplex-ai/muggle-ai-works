import { type BenchmarkTask } from "../domain/types";
import { BENCHMARK_TASK_FLAG } from "./constants";
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
 * reads exactly this one flag — so it is pinned here rather than assembled
 * inline at the spawn site.
 *
 * Output shape: `["--benchmark-task", "…/task.json"]`
 */
export const buildStudioArgv = (invocation: StudioInvocation): string[] => [
  BENCHMARK_TASK_FLAG,
  invocation.taskFilePath,
];
