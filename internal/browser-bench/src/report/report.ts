import { MAX_STEPS_PER_TASK } from "../domain/constants";
import { findPastDatedYears } from "../domain/past-dated-instruction";
import { BenchmarkOutcome, type BenchmarkTask, type TaskResult } from "../domain/types";

/**
 * Maps each task whose instruction pins a year already past to those years.
 *
 * Output shape: `Map { "Booking--5" => [2024] }`.
 */
const collectPastDatedTasks = (tasks: BenchmarkTask[], runYear: number): Map<string, number[]> => {
  const pastDated = new Map<string, number[]>();

  for (const task of tasks) {
    const years = findPastDatedYears(task.instruction, runYear);
    if (years.length > 0) pastDated.set(task.taskId, years);
  }

  return pastDated;
};

/**
 * Renders the batch report.
 *
 * The pass-rate denominator is passes + fails only — infrastructure errors and
 * bot-defence blocks are counted and reported separately so a lockout, a crash,
 * or a site that refuses automated access can never read as a capability
 * regression. This differs from how most published browser-agent scores are
 * computed, so any published number must say so.
 *
 * Blocked attempts get their own line and keep their rows in the table, printed
 * even at zero. A benchmark that reports what it could not reach is more honest
 * than one that hides it, and a line that appears only when non-zero is a line
 * nobody learns to look for.
 *
 * The step budget is printed beside the pass rate, and a budget above
 * WebVoyager's own cap is labelled a deviation in the same line as the score.
 * A raised budget makes the number incomparable to every published result, and
 * a caveat that lives only in the surrounding prose is a caveat that gets
 * dropped the first time someone quotes the figure.
 *
 * A task whose instruction pins a year already past is marked rather than
 * excluded. Whether the date makes it unanswerable belongs to the site — an
 * archive search over a past month is fine, a hotel booking for one is not — so
 * the report states the fact and leaves the judgement to the reader. The rate
 * with those tasks removed travels on the same line, for the same reason the
 * step-budget caveat does.
 *
 * Output shape: a Markdown document opening with
 * `**Pass rate:** 50.0% (scored 2, infrastructure errors 1)`.
 *
 * @param params.maxSteps - Steps each task was allowed.
 * @param params.tasks - The tasks behind these results, used only to read their instructions.
 * @param params.runYear - The calendar year the batch ran in.
 */
export const renderReport = (
  results: TaskResult[],
  {
    maxSteps = MAX_STEPS_PER_TASK,
    tasks = [],
    runYear = new Date().getFullYear(),
  }: { maxSteps?: number; tasks?: BenchmarkTask[]; runYear?: number } = {},
): string => {
  const passes = results.filter((result) => result.outcome === BenchmarkOutcome.Pass).length;
  const fails = results.filter((result) => result.outcome === BenchmarkOutcome.Fail).length;
  const errors = results.filter((result) => result.outcome === BenchmarkOutcome.Error).length;
  const blocked = results.filter((result) => result.outcome === BenchmarkOutcome.Blocked).length;
  const scored = passes + fails;
  const passRate = scored === 0 ? 0 : (passes / scored) * 100;
  const totalTokens = results.reduce((sum, result) => sum + result.tokensUsed, 0);

  const pastDatedTasks = collectPastDatedTasks(tasks, runYear);
  const currentDated = results.filter(
    (result) =>
      !pastDatedTasks.has(result.taskId) &&
      (result.outcome === BenchmarkOutcome.Pass || result.outcome === BenchmarkOutcome.Fail),
  );
  const currentDatedPasses = currentDated.filter(
    (result) => result.outcome === BenchmarkOutcome.Pass,
  ).length;
  const currentDatedRate =
    currentDated.length === 0 ? 0 : (currentDatedPasses / currentDated.length) * 100;
  const pastDatedInResults = results.filter((result) => pastDatedTasks.has(result.taskId)).length;

  return [
    `# Browser-capability benchmark`,
    ``,
    `**Pass rate:** ${passRate.toFixed(1)}% (scored ${scored}, infrastructure errors ${errors})`,
    `**Blocked by bot defence:** ${blocked} — the site refused automated access, so the agent's capability was never exercised; excluded from the pass rate`,
    `**Past-dated instructions:** ${pastDatedInResults}${
      pastDatedInResults > 0
        ? ` — the instruction pins a year already past, which a site accepting only future dates cannot satisfy at any capability; scored as normal and marked below. Excluding them the pass rate is ${currentDatedRate.toFixed(1)}% (scored ${currentDated.length})`
        : ""
    }`,
    `**Step budget:** ${maxSteps}${
      maxSteps > MAX_STEPS_PER_TASK
        ? ` — raised above WebVoyager's cap of ${MAX_STEPS_PER_TASK}; this score is NOT comparable to published WebVoyager results`
        : ""
    }`,
    `**Total tokens:** ${totalTokens}`,
    ``,
    `| Task | Outcome | Steps | Duration (ms) | Tokens | Past-dated |`,
    `| :--- | :------ | ----: | ------------: | -----: | :--------- |`,
    ...results.map(
      (result) =>
        `| ${result.taskId} | ${result.outcome} | ${result.stepCount} | ${result.durationMs} | ${result.tokensUsed} | ${pastDatedTasks.get(result.taskId)?.join(", ") ?? ""} |`,
    ),
  ].join("\n");
};
