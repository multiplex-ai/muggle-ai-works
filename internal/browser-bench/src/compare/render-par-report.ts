import { MAX_PASS_RATE_DROP_POINTS, MAX_STEP_TIME_RATIO } from "./constants";
import { type BatchParFigures, type SourceParVerdict } from "./types";

const formatMs = (milliseconds: number | undefined): string =>
  milliseconds === undefined ? "n/a" : `${Math.round(milliseconds)} ms`;

const formatClasses = (failureClasses: string[]): string =>
  failureClasses.length === 0 ? "none" : failureClasses.join(", ");

const renderRow = (role: string, figures: BatchParFigures): string =>
  `| ${role} | ${figures.modelSource} | ${figures.scoredCount} | ${figures.passRate.toFixed(1)}% | ${formatMs(figures.medianStepMs)} | ${formatClasses(figures.failureClasses)} |`;

/**
 * Renders a source comparison as Markdown, verdict first, with the bar each figure is held to.
 *
 * Output shape: a document opening with `# Model source comparison` and `**Verdict:** on par`.
 */
export const renderSourceParReport = (verdict: SourceParVerdict): string =>
  [
    `# Model source comparison`,
    ``,
    `**Verdict:** ${verdict.isPar ? "on par" : "not on par"} — ${verdict.candidate.modelSource} against ${verdict.baseline.modelSource} over ${verdict.taskCount} task(s)`,
    `**Median step time:** ${verdict.stepTimeRatio === undefined ? "n/a" : `${verdict.stepTimeRatio.toFixed(2)}×`} the baseline's (bar: at most ${MAX_STEP_TIME_RATIO}×)`,
    `**Pass rate:** ${verdict.passRateDeltaPoints >= 0 ? "+" : ""}${verdict.passRateDeltaPoints.toFixed(1)} points against the baseline (bar: at most ${MAX_PASS_RATE_DROP_POINTS} points below)`,
    `**New failure classes:** ${formatClasses(verdict.newFailureClasses)} (bar: none)`,
    ...(verdict.missedBars.length === 0 ? [] : [``, ...verdict.missedBars.map((missedBar) => `- ${missedBar}`)]),
    ``,
    `| Batch | Source | Scored | Pass rate | Median step time | Failure classes |`,
    `| :---- | :----- | -----: | --------: | ---------------: | :-------------- |`,
    renderRow("baseline", verdict.baseline),
    renderRow("candidate", verdict.candidate),
  ].join("\n");
