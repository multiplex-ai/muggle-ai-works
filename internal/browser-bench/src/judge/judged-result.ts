import * as path from "node:path";

import { type BenchmarkOutcome, type TaskResult } from "../domain/types";

/**
 * Replaces studio's self-reported outcome with the judge's verdict.
 *
 * Studio reporting `success` means its own run loop finished without erroring,
 * which is a liveness signal rather than a capability one. Scoring on it grades
 * the agent's homework with the agent's own marking, so the judged outcome is
 * what the report counts and studio's claim is kept beside it for triage.
 *
 * Output shape: `{ …, outcome: "fail", judgeVerdict: "fail", judgeReasoning: "Wrong recipe.", studioStatus: "success" }`
 */
export const applyJudgeVerdict = ({
  taskResult,
  verdict,
}: {
  taskResult: TaskResult;
  verdict: { outcome: BenchmarkOutcome; reasoning: string };
}): TaskResult => ({
  ...taskResult,
  outcome: verdict.outcome,
  judgeVerdict: verdict.outcome,
  judgeReasoning: verdict.reasoning,
});

/**
 * Resolves the screenshots one attempt captured, from its trajectory manifest.
 *
 * The manifest stores basenames so the folder stays portable; the judge needs
 * absolute paths, and this is the one place that mapping happens.
 *
 * A manifest that cannot be read is an error rather than an empty list: judging
 * an attempt with no screenshots is a legitimate case, but doing it because the
 * manifest was malformed reports a blind verdict as a sighted one.
 *
 * Output shape: `["C:/out/trajectories/Allrecipes--0/step001.png"]`
 *
 * @throws When the manifest is not JSON, or its `screenshots` field is not an array of names.
 */
export const resolveTrajectoryScreenshotPaths = ({
  trajectoryDir,
  manifestContent,
}: {
  trajectoryDir: string;
  manifestContent: string;
}): string[] => {
  let manifest: { screenshots?: unknown };
  try {
    manifest = JSON.parse(manifestContent) as { screenshots?: unknown };
  } catch {
    throw new Error(`Trajectory manifest in ${trajectoryDir} is not valid JSON.`);
  }

  const { screenshots } = manifest;
  if (!Array.isArray(screenshots) || screenshots.some((name) => typeof name !== "string")) {
    throw new Error(
      `Trajectory manifest in ${trajectoryDir} must list "screenshots" as an array of filenames.`,
    );
  }

  return screenshots.map((name) => path.join(trajectoryDir, name as string));
};
