import { BenchmarkOutcome, type TaskResult } from "../domain/types";

const isScored = (result: TaskResult): boolean =>
  result.outcome === BenchmarkOutcome.Pass || result.outcome === BenchmarkOutcome.Fail;

/**
 * Pass rate in percent over scored attempts only — errors and blocks never count against it.
 *
 * Output shape: `62.5`
 */
export const computePassRate = (results: TaskResult[]): number => {
  const scored = results.filter(isScored);
  if (scored.length === 0) return 0;
  const passes = scored.filter((result) => result.outcome === BenchmarkOutcome.Pass).length;
  return (passes / scored.length) * 100;
};

/**
 * Median wall time per agent step across scored attempts that took at least one step. Each
 * attempt contributes its own average, so a long task does not outweigh many short ones.
 *
 * Output shape: `4210` (milliseconds), or `undefined` when no attempt qualifies.
 */
export const computeMedianStepMs = (results: TaskResult[]): number | undefined => {
  const perStepMs = results
    .filter((result) => isScored(result) && result.stepCount > 0)
    .map((result) => result.durationMs / result.stepCount)
    .sort((left, right) => left - right);
  if (perStepMs.length === 0) return undefined;
  const middle = Math.floor(perStepMs.length / 2);
  return perStepMs.length % 2 === 1 ? perStepMs[middle] : (perStepMs[middle - 1] + perStepMs[middle]) / 2;
};
