import { BenchmarkOutcome, type TaskResult } from "../domain/types";

/**
 * Renders the batch report.
 *
 * The pass-rate denominator is passes + fails only — infrastructure errors are
 * counted and reported separately so a lockout or a crash can never read as a
 * capability regression. This differs from how most published browser-agent
 * scores are computed, so any published number must say so.
 *
 * Output shape: a Markdown document opening with
 * `**Pass rate:** 50.0% (scored 2, infrastructure errors 1)`.
 */
export const renderReport = (results: TaskResult[]): string => {
  const passes = results.filter((result) => result.outcome === BenchmarkOutcome.Pass).length;
  const fails = results.filter((result) => result.outcome === BenchmarkOutcome.Fail).length;
  const errors = results.filter((result) => result.outcome === BenchmarkOutcome.Error).length;
  const scored = passes + fails;
  const passRate = scored === 0 ? 0 : (passes / scored) * 100;
  const totalTokens = results.reduce((sum, result) => sum + result.tokensUsed, 0);

  return [
    `# Browser-capability benchmark`,
    ``,
    `**Pass rate:** ${passRate.toFixed(1)}% (scored ${scored}, infrastructure errors ${errors})`,
    `**Total tokens:** ${totalTokens}`,
    ``,
    `| Task | Outcome | Steps | Duration (ms) | Tokens |`,
    `| :--- | :------ | ----: | ------------: | -----: |`,
    ...results.map(
      (result) =>
        `| ${result.taskId} | ${result.outcome} | ${result.stepCount} | ${result.durationMs} | ${result.tokensUsed} |`,
    ),
  ].join("\n");
};
