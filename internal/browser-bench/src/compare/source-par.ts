import { BenchmarkOutcome, type ModelSource, type TaskResult } from "../domain/types";
import { computeMedianStepMs, computePassRate } from "../stats/batch-stats";
import { MAX_PASS_RATE_DROP_POINTS, MAX_STEP_TIME_RATIO } from "./constants";
import { classifyFailure } from "./failure-class";
import { type BatchParFigures, type SourceParVerdict } from "./types";

// Error rows the orchestrator builds carry no source, so a batch's source comes from the rest.
const resolveBatchSource = (batchName: string, results: TaskResult[]): ModelSource => {
  const sources = [
    ...new Set(results.map((result) => result.modelSource).filter((source) => source !== undefined)),
  ];
  if (sources.length === 0) {
    throw new Error(
      `The ${batchName} batch has no recorded model source. Run it with --model-source so the comparison knows what it measured.`,
    );
  }
  if (sources.length > 1) {
    throw new Error(`The ${batchName} batch mixes model sources (${sources.join(", ")}).`);
  }
  return sources[0] as ModelSource;
};

const assertSameTasks = (baselineResults: TaskResult[], candidateResults: TaskResult[]): void => {
  const baselineTaskIds = new Set(baselineResults.map((result) => result.taskId));
  const candidateTaskIds = new Set(candidateResults.map((result) => result.taskId));
  const onlyInBaseline = [...baselineTaskIds].filter((taskId) => !candidateTaskIds.has(taskId));
  const onlyInCandidate = [...candidateTaskIds].filter((taskId) => !baselineTaskIds.has(taskId));
  if (onlyInBaseline.length === 0 && onlyInCandidate.length === 0) return;
  throw new Error(
    `The batches ran different tasks — only in baseline: [${onlyInBaseline.join(", ")}], ` +
      `only in candidate: [${onlyInCandidate.join(", ")}]. Run both on the same task file and sample.`,
  );
};

const summarizeBatch = (modelSource: ModelSource, results: TaskResult[]): BatchParFigures => ({
  modelSource: modelSource,
  scoredCount: results.filter(
    (result) => result.outcome === BenchmarkOutcome.Pass || result.outcome === BenchmarkOutcome.Fail,
  ).length,
  passRate: computePassRate(results),
  medianStepMs: computeMedianStepMs(results),
  failureClasses: [
    ...new Set(results.map(classifyFailure).filter((failureClass) => failureClass !== undefined)),
  ].sort() as string[],
});

/**
 * Judges whether the candidate batch's source performs on par with the baseline's: median per-step
 * wall time at most {@link MAX_STEP_TIME_RATIO}× the baseline's, pass rate at most
 * {@link MAX_PASS_RATE_DROP_POINTS} points below it, and no failure class the baseline lacks.
 *
 * Output shape: `{ isPar: false, stepTimeRatio: 1.41, passRateDeltaPoints: -0.8,
 * newFailureClasses: ["error:exit-3"], missedBars: ["Median step time 1.41× …"], … }`
 *
 * @throws When the batches ran different tasks, a batch has no single recorded source, or both ran on
 * the same source.
 */
export const evaluateSourcePar = ({
  baselineResults,
  candidateResults,
}: {
  baselineResults: TaskResult[];
  candidateResults: TaskResult[];
}): SourceParVerdict => {
  assertSameTasks(baselineResults, candidateResults);
  const baselineSource = resolveBatchSource("baseline", baselineResults);
  const candidateSource = resolveBatchSource("candidate", candidateResults);
  if (baselineSource === candidateSource) {
    throw new Error(`Both batches ran on ${baselineSource}; a source comparison needs two different sources.`);
  }

  const baseline = summarizeBatch(baselineSource, baselineResults);
  const candidate = summarizeBatch(candidateSource, candidateResults);
  const stepTimeRatio =
    baseline.medianStepMs !== undefined && candidate.medianStepMs !== undefined && baseline.medianStepMs > 0
      ? candidate.medianStepMs / baseline.medianStepMs
      : undefined;
  const passRateDeltaPoints = candidate.passRate - baseline.passRate;
  const newFailureClasses = candidate.failureClasses.filter(
    (failureClass) => !baseline.failureClasses.includes(failureClass),
  );

  const missedBars: string[] = [];
  if (stepTimeRatio === undefined) {
    missedBars.push("Median step time could not be compared: a batch has no scored attempt that took a step.");
  } else if (stepTimeRatio > MAX_STEP_TIME_RATIO) {
    missedBars.push(`Median step time ${stepTimeRatio.toFixed(2)}× the baseline's, above ${MAX_STEP_TIME_RATIO}×.`);
  }
  if (passRateDeltaPoints < -MAX_PASS_RATE_DROP_POINTS) {
    missedBars.push(
      `Pass rate ${Math.abs(passRateDeltaPoints).toFixed(1)} points below the baseline's, more than ${MAX_PASS_RATE_DROP_POINTS}.`,
    );
  }
  if (newFailureClasses.length > 0) {
    missedBars.push(`New failure classes: ${newFailureClasses.join(", ")}.`);
  }

  return {
    baseline: baseline,
    candidate: candidate,
    taskCount: baselineResults.length,
    stepTimeRatio: stepTimeRatio,
    passRateDeltaPoints: passRateDeltaPoints,
    newFailureClasses: newFailureClasses,
    isPar: missedBars.length === 0,
    missedBars: missedBars,
  };
};
