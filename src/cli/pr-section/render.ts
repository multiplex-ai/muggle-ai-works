/**
 * Pure markdown emitters for the PR body evidence block and the overflow comment.
 * No I/O, no length measurement, no overflow logic — see overflow.ts for that.
 *
 * Layout (two sections):
 *   1. Overview: counts + per-test name list (numbered; grouped by useCaseName when present).
 *   2. Per-test details: one <details> block per numbered test (passed and failed alike),
 *      in report order, showing the ending screen (a caption-labelled screenshot) and
 *      a compact result summary.
 */

import type { E2eReport, Step, TestResult } from "./types.js";

export const DASHBOARD_URL_BASE =
  "https://www.muggle-ai.com/muggleTestV0/dashboard/projects";

/** Width of the per-test ending screenshot inside each <details> block. */
const DETAIL_IMAGE_WIDTH = 720;

/** The screenshot + caption displayed inside each test's details block. */
interface IEndingFrame {
  /** HTTPS URL of the screenshot to render. */
  url: string;
  /** Short human-readable caption labelling what the screenshot shows. */
  caption: string;
}

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

/** The "ending screenshot" step for a test: failure-step for failed, last step for passed. */
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

/** Default caption text used when the caller doesn't provide one. */
function defaultEndingCaption (test: TestResult): string {
  if (test.status === "failed") {
    return `Failure at step ${test.failureStepIndex}`;
  }
  return "Final page after the test completed";
}

/**
 * Resolve the single screenshot + caption rendered inside a test's details block.
 *
 * Precedence: an explicit `endingScreenshotUrl` on the test wins (this is how
 * a caller surfaces the action script's dedicated summary step), otherwise
 * we fall back to the failure / last step from `steps[]`.
 */
function endingFrame (test: TestResult): IEndingFrame | null {
  if (test.endingScreenshotUrl) {
    return {
      url: test.endingScreenshotUrl,
      caption: test.endingScreenshotCaption ?? defaultEndingCaption(test),
    };
  }
  const step = endingScreenshot(test);
  if (!step) {
    return null;
  }
  return {
    url: step.screenshotUrl,
    caption: test.endingScreenshotCaption ?? defaultEndingCaption(test),
  };
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
 * Build a `Map<testCaseId, testNumber>` so both the overview and the per-test
 * details use the same 1-based numbering regardless of grouping. Tests without
 * a testCaseId (shouldn't happen — schema requires it) are silently skipped.
 */
function buildTestNumbering (report: E2eReport): Map<string, number> {
  const map = new Map<string, number>();
  report.tests.forEach((t, i) => {
    map.set(t.testCaseId, i + 1);
  });
  return map;
}

/**
 * Render the overview section: header, counts line, and the per-test numbered
 * name list (grouped by useCaseName when any test has one, otherwise flat).
 * Numbering is global across groups so it matches the details block headings.
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
  const numbering = buildTestNumbering(report);
  const anyGrouped = report.tests.some((t) => Boolean(t.useCaseName));
  if (!anyGrouped) {
    for (const t of report.tests) {
      lines.push(`- **${numbering.get(t.testCaseId)}.** ${statusEmoji(t)} ${t.name}`);
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
      lines.push(`- **${numbering.get(entry.test.testCaseId)}.** ${statusEmoji(entry.test)} ${entry.test.name}`);
    } else {
      lines.push(`- **${entry.key}**`);
      for (const t of groups.get(entry.key)!) {
        lines.push(`  - **${numbering.get(t.testCaseId)}.** ${statusEmoji(t)} ${t.name}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Render one `<details>` block for a test case (passed or failed).
 *
 * `testNumber` is the 1-based index used to prefix the collapsible summary line
 * so it lines up with the numbered list in the overview section.
 */
export function renderTestDetails (test: TestResult, projectId: string, testNumber: number): string {
  const summary = renderSummaryLine(test, testNumber);
  const frameBlock = renderEndingFrame(test);
  const resultLines = renderResultSummary(test, projectId);
  const body: string[] = ["", "<br>", ""];
  if (frameBlock) {
    body.push(...frameBlock, "");
  }
  body.push(...resultLines);
  return `<details>\n<summary>${summary}</summary>\n${body.join("\n")}\n\n</details>`;
}

function renderSummaryLine (test: TestResult, testNumber: number): string {
  const base = `<b>${testNumber}. ${test.name}</b> ${statusEmoji(test)}`;
  const tail = " <i>▶ click to expand</i>";
  if (test.description) {
    return `${base} — ${test.description}${tail}`;
  }
  return `${base}${tail}`;
}

/**
 * Render the ending-frame block: a bold caption line identifying what the
 * screenshot shows, followed by the clickable full-width image. Returns null
 * if there is nothing to render (e.g. an empty-steps passed test with no
 * endingScreenshotUrl override).
 */
function renderEndingFrame (test: TestResult): string[] | null {
  const frame = endingFrame(test);
  if (!frame) {
    return null;
  }
  return [
    `**📸 Ending screen — ${frame.caption}**`,
    "",
    fullSizeImage(frame.url, test.name),
  ];
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
  const detailBlocks = report.tests.map((t, i) => renderTestDetails(t, report.projectId, i + 1));
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
  const detailBlocks = report.tests.map((t, i) => renderTestDetails(t, report.projectId, i + 1));
  return [
    "## E2E acceptance evidence (overflow)",
    "",
    "_This comment was posted because the full per-test details did not fit in the PR description._",
    "",
    detailBlocks.join("\n\n"),
  ].join("\n");
}

