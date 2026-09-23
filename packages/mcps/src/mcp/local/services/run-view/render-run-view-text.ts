import { HTML_VIEW_OFFER_LINE } from "./run-view-constants.js";
import type { IRunView } from "./run-view-types.js";

/**
 * Render a run as plain text: the header, every step in order, then the verdict.
 *
 * The verdict is printed **after** the steps on purpose. This tool exists because a run's closing
 * claim and its own frames disagreed, and reading the claim last is what makes that visible.
 * @param runView - The run to render.
 * @param options.includeHtmlOffer - Append the line telling the reader how to see the frames.
 *   True for a terminal, where the frames cannot be shown; false for callers that render them.
 * @returns The rendered text.
 */
export function renderRunViewText(
  runView: IRunView,
  options: { includeHtmlOffer: boolean },
): string {
  const header = [
    `Run ${runView.runId}${runView.title ? ` — ${runView.title}` : ""}`,
    `${runView.status ?? "status unrecorded"} · ${runView.steps.length} steps · ${runView.screenshotCount} frames`,
    runView.sessionPath,
    "",
  ];

  const stepLines =
    runView.steps.length === 0
      ? ["(no steps recorded — the run ended before writing any)"]
      : runView.steps.flatMap((step) => {
          const lines = [
            `${String(step.index).padStart(2, " ")}  ${step.action}${step.url ? `  → ${step.url}` : ""}`,
          ];
          if (step.explanation) {
            lines.push(`    ${step.explanation}`);
          }
          lines.push(`    ${step.screenshotPath ?? "(no frame recorded)"}`);
          return lines;
        });

  const verdict = runView.verdict ? ["", `Verdict: ${runView.verdict}`] : [];
  const offer = options.includeHtmlOffer ? ["", HTML_VIEW_OFFER_LINE] : [];

  return [...header, ...stepLines, ...verdict, ...offer].join("\n");
}
