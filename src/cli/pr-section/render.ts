/**
 * Pure markdown emitters for the PR body evidence block and the overflow comment.
 * No I/O, no length measurement, no overflow logic — see overflow.ts for that.
 */

import { buildOneLiner, selectHero } from "./selectors.js";
import type { E2eReport, FailedTest, TestResult, Step } from "./types.js";

export const DASHBOARD_URL_BASE =
  "https://www.muggle-ai.com/muggleTestV0/dashboard/projects";

/** Width of thumbnails in the per-test compact rows. */
const ROW_THUMB_WIDTH = 120;
/** Width of thumbnails in the collapsible failure-details blocks. */
const DETAIL_THUMB_WIDTH = 200;
/** Width of the hero image in the summary block. */
const HERO_WIDTH = 480;

/** Build a clickable thumbnail image: links to full size, displays at width. */
function thumbnail (url: string, width: number): string {
  return `<a href="${url}"><img src="${url}" width="${width}"></a>`;
}

/** Compact counts string, e.g. "3 passed / 1 failed". */
function counts (report: E2eReport): { passed: number; failed: number; text: string } {
  const passed = report.tests.filter((t) => t.status === "passed").length;
  const failed = report.tests.filter((t) => t.status === "failed").length;
  return { passed, failed, text: `**${passed} passed / ${failed} failed**` };
}

/**
 * Render the top summary block: counts, one-liner, hero screenshot, dashboard link.
 */
export function renderSummary (report: E2eReport): string {
  const { text: countsLine } = counts(report);
  const oneLiner = buildOneLiner(report);
  const hero = selectHero(report);
  const dashboard = `${DASHBOARD_URL_BASE}/${report.projectId}/scripts`;
  const lines: string[] = [
    countsLine,
    "",
    oneLiner,
    "",
  ];
  if (hero) {
    lines.push(
      `<a href="${hero.screenshotUrl}"><img src="${hero.screenshotUrl}" width="${HERO_WIDTH}" alt="${hero.testName}"></a>`,
      "",
    );
  }
  lines.push(`[View project dashboard on muggle-ai.com](${dashboard})`);
  return lines.join("\n");
}

/**
 * Render one compact row for a test case. Caller is responsible for wrapping rows
 * in a markdown table header.
 */
export function renderRow (test: TestResult): string {
  const link = `[${test.name}](${test.viewUrl})`;
  if (test.status === "passed") {
    const lastStep = test.steps[test.steps.length - 1];
    const thumb = lastStep ? thumbnail(lastStep.screenshotUrl, ROW_THUMB_WIDTH) : "—";
    return `| ${link} | ✅ PASSED | ${thumb} |`;
  }
  const failStep = test.steps.find((s) => s.stepIndex === test.failureStepIndex);
  const thumb = failStep ? thumbnail(failStep.screenshotUrl, ROW_THUMB_WIDTH) : "—";
  return `| ${link} | ❌ FAILED — ${test.error} | ${thumb} |`;
}

/** Render one collapsible `<details>` block for a failed test. */
export function renderFailureDetails (test: FailedTest): string {
  const stepCount = test.steps.length;
  const header = `<details>\n<summary>📸 <strong>${test.name}</strong> — ${stepCount} steps (failed at step ${test.failureStepIndex})</summary>\n\n| # | Action | Screenshot |\n|---|--------|------------|`;
  const rows = test.steps.map((step) => renderFailureStepRow(step, test)).join("\n");
  return `${header}\n${rows}\n\n</details>`;
}

function renderFailureStepRow (step: Step, test: FailedTest): string {
  const isFailure = step.stepIndex === test.failureStepIndex;
  const marker = isFailure ? `${step.stepIndex} ⚠️` : String(step.stepIndex);
  const action = isFailure
    ? `${step.action} — **${test.error}**`
    : step.action;
  return `| ${marker} | ${action} | ${thumbnail(step.screenshotUrl, DETAIL_THUMB_WIDTH)} |`;
}

/** Render the compact per-test table (always goes in the body). */
function renderRowsTable (report: E2eReport): string {
  if (report.tests.length === 0) {
    return "_No tests were executed._";
  }
  const header = "| Test Case | Status | Evidence |\n|-----------|--------|----------|";
  const rows = report.tests.map(renderRow).join("\n");
  return `${header}\n${rows}`;
}

/** Options for renderBody. */
export interface IRenderBodyOptions {
  /**
   * When true, collapsible `<details>` blocks for failed tests are included inline in the body.
   * When false, a single pointer line is written instead and the details are expected to be
   * posted as an overflow comment by the caller.
   */
  inlineFailureDetails: boolean;
}

/** Render the full PR-body evidence block (top summary + rows + optional details). */
export function renderBody (report: E2eReport, opts: IRenderBodyOptions): string {
  const sections: string[] = [
    "## E2E Acceptance Results",
    "",
    renderSummary(report),
    "",
    renderRowsTable(report),
  ];
  const failures = report.tests.filter((t): t is FailedTest => t.status === "failed");
  if (failures.length > 0) {
    if (opts.inlineFailureDetails) {
      sections.push("", ...failures.map(renderFailureDetails));
    } else {
      sections.push(
        "",
        "_Full step-by-step evidence in the comment below — the PR description was too large to inline it._",
      );
    }
  }
  return sections.join("\n");
}

/** Render the overflow comment body. Returns empty string if there are no failures to show. */
export function renderComment (report: E2eReport): string {
  const failures = report.tests.filter((t): t is FailedTest => t.status === "failed");
  if (failures.length === 0) {
    return "";
  }
  const sections: string[] = [
    "## E2E acceptance evidence (overflow)",
    "",
    "_This comment was posted because the full step-by-step evidence did not fit in the PR description._",
    "",
    ...failures.map(renderFailureDetails),
  ];
  return sections.join("\n");
}
