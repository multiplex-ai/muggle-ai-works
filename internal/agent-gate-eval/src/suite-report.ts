/** Aggregates a suite's rep verdicts into per-scenario pass rates and names its results file. */

import * as path from "node:path";

import type { ScenarioReport } from "../../skill-gate-eval/src/types.js";
import { EvalHost } from "../../skill-gate-eval/src/types.js";
import { CODEX_RESULTS_INFIX, RESULTS_FILE_SUFFIX } from "./constants.js";
import type { AgentRunVerdict, ScenarioSuite } from "./types.js";

/** One scenario's pass rate over its reps, judged against the suite's pass threshold. */
export function summarizeScenarioVerdicts(
  scenarioName: string,
  verdicts: AgentRunVerdict[],
  passThreshold: number,
): ScenarioReport {
  const passes = verdicts.filter((verdict) => verdict.pass).length;
  const passRate = verdicts.length === 0 ? 0 : passes / verdicts.length;
  return {
    name: scenarioName,
    runs: verdicts.length,
    passes: passes,
    passRate: passRate,
    passed: verdicts.length > 0 && passRate >= passThreshold,
    failureReasons: Array.from(new Set(verdicts.flatMap((verdict) => verdict.reasons))),
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
