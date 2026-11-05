import { NO_CONCLUSIVE_RUNS_REASON } from "./constants.js";
import type { JudgedRep, ScenarioReport } from "./types.js";

/**
 * One scenario's pass rate over its conclusive reps, judged against `passThreshold`. A scenario with no
 * conclusive rep fails: a usage limit is never evidence the target works.
 */
export function summarizeJudgedReps(
  scenarioName: string,
  judgedReps: JudgedRep[],
  passThreshold: number,
): ScenarioReport {
  const conclusiveReps = judgedReps.filter((rep) => !rep.isInconclusive);
  const inconclusiveRuns = judgedReps.length - conclusiveReps.length;
  const passes = conclusiveReps.filter((rep) => rep.pass).length;
  const passRate = conclusiveReps.length === 0 ? 0 : passes / conclusiveReps.length;
  const failureReasons = Array.from(new Set(conclusiveReps.flatMap((rep) => rep.reasons)));
  if (conclusiveReps.length === 0 && inconclusiveRuns > 0) failureReasons.push(NO_CONCLUSIVE_RUNS_REASON);
  return {
    name: scenarioName,
    runs: conclusiveReps.length,
    passes: passes,
    passRate: passRate,
    passed: conclusiveReps.length > 0 && passRate >= passThreshold,
    inconclusiveRuns: inconclusiveRuns,
    failureReasons: failureReasons,
  };
}

/**
 * The note a report line carries for reps a usage limit stopped.
 *
 * Output shape: `, 2 no result (usage limit)`, or `` when every rep was judged.
 */
export function formatNoResultNote(report: Pick<ScenarioReport, "inconclusiveRuns">): string {
  return report.inconclusiveRuns > 0 ? `, ${report.inconclusiveRuns} no result (usage limit)` : "";
}
