import { BenchmarkOutcome, type TaskResult } from "../domain/types";
import { STUDIO_STATUS_SUCCESS } from "./constants";
import { type StudioResultFile } from "./types";

const requireString = (record: Record<string, unknown>, field: string): string => {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`Studio result field "${field}" must be a string, got ${JSON.stringify(value)}.`);
  }
  return value;
};

const requireNumber = (record: Record<string, unknown>, field: string): number => {
  const value = record[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Studio result field "${field}" must be a number, got ${JSON.stringify(value)}.`);
  }
  return value;
};

/**
 * Parses the `result.json` studio wrote for one attempt.
 *
 * The task id is checked against the one the harness asked for, so a result
 * left behind by an earlier run can never be scored as this task's.
 *
 * Output shape: `{ taskId: "Allrecipes--0", finalAnswer: "…", studioStatus: "success",
 * stepCount: 7, durationMs: 41230, trajectoryDir: "…/trajectories/Allrecipes--0" }`
 *
 * @throws When the file is not JSON, a field is missing or mistyped, or the
 * task id does not match `expectedTaskId`.
 */
export const parseStudioResult = ({
  jsonContent,
  expectedTaskId,
}: {
  jsonContent: string;
  expectedTaskId: string;
}): StudioResultFile => {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(jsonContent) as Record<string, unknown>;
  } catch {
    throw new Error(`Studio result for task ${expectedTaskId} is not valid JSON.`);
  }

  const studioResult: StudioResultFile = {
    taskId: requireString(record, "taskId"),
    finalAnswer: requireString(record, "finalAnswer"),
    studioStatus: requireString(record, "studioStatus"),
    stepCount: requireNumber(record, "stepCount"),
    durationMs: requireNumber(record, "durationMs"),
    trajectoryDir: requireString(record, "trajectoryDir"),
  };

  if (studioResult.taskId !== expectedTaskId) {
    throw new Error(
      `Studio result reports task ${studioResult.taskId} but ${expectedTaskId} was requested.`,
    );
  }

  return studioResult;
};

/**
 * Maps a studio result onto the harness's record of the attempt.
 *
 * The outcome here is studio's own claim; `judgeVerdict` stays unset until the
 * judging pass overrules it. `tokensUsed` is 0 because studio does not report
 * token spend yet — the field is real, the number is not measured.
 *
 * Output shape: `{ taskId: "Allrecipes--0", outcome: "pass", studioStatus: "success",
 * stepCount: 7, durationMs: 41230, tokensUsed: 0, trajectoryDir: "…" }`
 */
export const toTaskResult = (studioResult: StudioResultFile): TaskResult => ({
  taskId: studioResult.taskId,
  outcome:
    studioResult.studioStatus === STUDIO_STATUS_SUCCESS
      ? BenchmarkOutcome.Pass
      : BenchmarkOutcome.Fail,
  finalAnswer: studioResult.finalAnswer,
  studioStatus: studioResult.studioStatus,
  stepCount: studioResult.stepCount,
  durationMs: studioResult.durationMs,
  tokensUsed: 0,
  trajectoryDir: studioResult.trajectoryDir,
});
