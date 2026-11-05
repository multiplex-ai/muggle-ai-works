/** Aggregates a suite's rep verdicts into per-scenario pass rates and names its results file. */

import * as path from "node:path";

import { summarizeJudgedReps } from "../../skill-gate-eval/src/scenario-report.js";
import { EvalHost } from "../../skill-gate-eval/src/types.js";
import { CODEX_RESULTS_INFIX, RESULTS_FILE_SUFFIX } from "./constants.js";
import type { AgentRunVerdict, AgentScenarioReport, ScenarioSuite } from "./types.js";

function meanOf(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * One scenario's pass rate over its conclusive reps, judged against the suite's pass threshold, with a rep's mean
 * cost and time. A scenario with no conclusive rep fails: a usage limit is never evidence the target works.
 */
export function summarizeScenarioVerdicts(
  scenarioName: string,
  verdicts: AgentRunVerdict[],
  passThreshold: number,
): AgentScenarioReport {
  const usages = verdicts.flatMap((verdict) => (verdict.usage ? [verdict.usage] : []));
  return {
    ...summarizeJudgedReps(scenarioName, verdicts, passThreshold),
    meanCostUsd: meanOf(usages.map((usage) => usage.costUsd)),
    meanDurationMs: meanOf(usages.map((usage) => usage.durationMs)),
  };
}

/**
 * Where a suite's results land, beside its scenario file. Both names end in
 * `.results.json`, so CI's scenario loop and the coverage test skip them.
 *
 * Output shape: `<dir>/muggle-do.handoff.results.json`, or `<dir>/<stem>.codex.results.json` under Codex.
 */
export function suiteResultsPath(suite: ScenarioSuite, host: EvalHost): string {
  const hostInfix = host === EvalHost.Codex ? CODEX_RESULTS_INFIX : "";
  return path.join(path.dirname(suite.filePath), `${suite.stem}${hostInfix}${RESULTS_FILE_SUFFIX}`);
}
