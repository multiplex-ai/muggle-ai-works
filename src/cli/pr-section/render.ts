/**
 * Pure markdown emitters for the PR body evidence block and the overflow comment.
 * No I/O, no length measurement, no overflow logic — see overflow.ts for that.
 *
 * Layout (two sections):
 *   1. Overview: counts + per-test name list, grouped by useCaseName when present.
 *   2. Per-test details: one <details> block per test (passed and failed alike), in
 *      report order, showing the ending screenshot and a compact result summary.
 */

import type { E2eReport, Step, TestResult } from "./types.js";

export const DASHBOARD_URL_BASE =
  "https://www.muggle-ai.com/muggleTestV0/dashboard/projects";

/** Width of the per-test ending screenshot inside each <details> block. */
const DETAIL_IMAGE_WIDTH = 720;

/** Compact counts for a report. */
interface ICounts {
  total: number;
  passed: number;
  failed: number;
}

function countTests (report: E2eReport): ICounts {
  const total = report.tests.length;
  const passed = report.tests.filter((t) => t.status === "passed").length;
  const failed = report.tests.filter((t) => t.status === "failed").length;
  return { total, passed, failed };
}

function statusEmoji (test: TestResult): string {
  return test.status === "passed" ? "✅" : "❌";
}

/** The "ending screenshot" for a test: failure-step for failed, last step for passed. */
function endingScreenshot (test: TestResult): Step | null {
  if (test.steps.length === 0) {
    return null;
  }
  if (test.status === "failed") {
    const failStep = test.steps.find((s) => s.stepIndex === test.failureStepIndex);
    if (failStep) {
      return failStep;
    }
    // Fall back to the last step if the failure index isn't represented.
    return test.steps[test.steps.length - 1];
  }
  return test.steps[test.steps.length - 1];
}

/** Clickable full-width image. */
function fullSizeImage (url: string, alt: string): string {
  return `<a href="${url}"><img src="${url}" width="${DETAIL_IMAGE_WIDTH}" alt="${alt}"></a>`;
}

/** Escape backticks in an error message so inline-code formatting stays balanced. */
function safeInlineCode (s: string): string {
  // Replace backticks with the visually-similar U+2018/U+2019 so the surrounding
  // inline-code markers don't get closed early.
  return s.replace(/`/g, "\u2018");
}

/**
 * Render the overview section: header, counts line, and the per-test name list
 * (grouped by useCaseName when any test has one, otherwise flat).
 */
export function renderOverview (report: E2eReport): string {
  const { total, passed, failed } = countTests(report);
  const lines: string[] = [
    "## E2E Acceptance Results",
    "",
    `**${total} tests ran — ${passed} passed / ${failed} failed**`,
  ];
  if (total === 0) {
    lines.push("", "_No tests were executed._");
    return lines.join("\n");
  }
  lines.push("", "**Tests run:**");
  const anyGrouped = report.tests.some((t) => Boolean(t.useCaseName));
  if (!anyGrouped) {
    for (const t of report.tests) {
      lines.push(`- ${statusEmoji(t)} ${t.name}`);
    }
    return lines.join("\n");
  }
  // Grouped layout. Preserve first-seen order of use case groups; ungrouped tests
  // are rendered as top-level bullets interleaved at their position in the report.
  const groupOrder: string[] = [];
  const groups = new Map<string, TestResult[]>();
  const flat: Array<{ type: "group"; key: string } | { type: "test"; test: TestResult }> = [];
  const seenGroups = new Set<string>();
  for (const t of report.tests) {
    if (t.useCaseName) {
      if (!groups.has(t.useCaseName)) {
        groups.set(t.useCaseName, []);
        groupOrder.push(t.useCaseName);
      }
      groups.get(t.useCaseName)!.push(t);
      if (!seenGroups.has(t.useCaseName)) {
        seenGroups.add(t.useCaseName);
        flat.push({ type: "group", key: t.useCaseName });
      }
    } else {
      flat.push({ type: "test", test: t });
    }
  }
  for (const entry of flat) {
    if (entry.type === "test") {
      lines.push(`- ${statusEmoji(entry.test)} ${entry.test.name}`);
    } else {
      lines.push(`- **${entry.key}**`);
      for (const t of groups.get(entry.key)!) {
        lines.push(`  - ${statusEmoji(t)} ${t.name}`);
      }
    }
  }
  return lines.join("\n");
}

/** Render one `<details>` block for a test case (passed or failed). */
export function renderTestDetails (test: TestResult, projectId: string): string {
  const summary = renderSummaryLine(test);
  const image = renderEndingImage(test);
  const resultLines = renderResultSummary(test, projectId);
  const body: string[] = ["", "<br>", ""];
  if (image) {
    body.push(image, "");
  }
  body.push(...resultLines);
  return `<details>\n<summary>${summary}</summary>\n${body.join("\n")}\n\n</details>`;
}

function renderSummaryLine (test: TestResult): string {
  const base = `${statusEmoji(test)} <b>${test.name}</b>`;
  const tail = " <i>▶ click to expand</i>";
  if (test.description) {
    return `${base} — ${test.description}${tail}`;
  }
  return `${base}${tail}`;
}

function renderEndingImage (test: TestResult): string | null {
  const step = endingScreenshot(test);
  if (!step) {
    return null;
  }
  return fullSizeImage(step.screenshotUrl, test.name);
}

function renderResultSummary (test: TestResult, projectId: string): string[] {
  const dashboardUrl = `${DASHBOARD_URL_BASE}/${projectId}/scripts?modal=script-details&testCaseId=${encodeURIComponent(test.testCaseId)}`;
  const lines: string[] = [];
  if (test.status === "passed") {
    lines.push(`**Result:** ✅ PASSED`);
  } else {
    lines.push(`**Result:** ❌ FAILED at step ${test.failureStepIndex}`);
    lines.push(`**Error:** \`${safeInlineCode(test.error)}\``);
  }
  lines.push(`**Steps:** ${test.steps.length}`);
  lines.push(`[View on Muggle AI dashboard →](${dashboardUrl})`);
  return lines;
}

/** Options for renderBody. */
export interface IRenderBodyOptions {
  /**
   * When true, the per-test `<details>` blocks are included inline in the body.
   * When false, a single pointer line is written instead and the details are expected
   * to be posted as an overflow comment by the caller.
   */
  inlineDetails: boolean;
}

/** Render the full PR-body evidence block (overview + optional per-test details). */
export function renderBody (report: E2eReport, opts: IRenderBodyOptions): string {
  const overview = renderOverview(report);
  if (report.tests.length === 0) {
    return overview;
  }
  if (!opts.inlineDetails) {
    return [
      overview,
      "",
      "---",
      "",
      "_Full per-test details in the comment below — the PR description was too large to inline them._",
    ].join("\n");
  }
  const detailBlocks = report.tests.map((t) => renderTestDetails(t, report.projectId));
  return [
    overview,
    "",
    "---",
    "",
    detailBlocks.join("\n\n"),
  ].join("\n");
}

/** Render the overflow comment body. Returns empty string if there are no tests. */
export function renderComment (report: E2eReport): string {
  if (report.tests.length === 0) {
    return "";
  }
  const detailBlocks = report.tests.map((t) => renderTestDetails(t, report.projectId));
  return [
    "## E2E acceptance evidence (overflow)",
    "",
    "_This comment was posted because the full per-test details did not fit in the PR description._",
    "",
    detailBlocks.join("\n\n"),
  ].join("\n");
}

