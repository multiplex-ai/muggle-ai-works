/**
 * Pure markdown emitters for the PR body evidence block and the overflow comment.
 * No I/O, no length measurement, no overflow logic — see overflow.ts for that.
 *
 * Layout (two sections):
 *   1. Summary: verdict headline + per-test name list (numbered; grouped by useCaseName when present).
 *   2. Test details: one <details> block per test case, in report order, showing the
 *      result, an elided step list, and the ending screen.
 *
 * A test case that ran more than once collapses to a single entry carrying its
 * latest run; see resolveLatestRuns.
 */

import {
  DASHBOARD_URL_BASE,
  DETAIL_IMAGE_WIDTH,
  STEP_LIST_ELISION_THRESHOLD,
  STEP_LIST_HEAD_COUNT,
  STEP_LIST_TAIL_COUNT,
} from "./constants.js";
import type { E2eReport, Step, TestResult } from "./types.js";

/** A test case reduced to its latest run, plus how many runs it had. */
export interface ILatestRun {
  /** The most recent run recorded for this test case. */
  test: TestResult;
  /** Total runs recorded for the test case, including the one rendered. */
  attempts: number;
}

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
  inconclusive: number;
}

/**
 * Collapse repeated runs of the same test case to one entry holding the latest.
 *
 * A report legitimately repeats a testCaseId when a run is followed by a rerun.
 * Listing each run separately shows the reader the same test case twice and
 * counts it twice, so the last occurrence — the outcome that currently stands —
 * replaces the earlier ones. Entries keep their first-seen position so the
 * ordering stays stable when a rerun is appended.
 *
 * Output shape: `[{ test, attempts: 2 }, { test, attempts: 1 }]`
 */
export function resolveLatestRuns (tests: readonly TestResult[]): ILatestRun[] {
  const byCaseId = new Map<string, ILatestRun>();
  const order: string[] = [];
  for (const test of tests) {
    const existing = byCaseId.get(test.testCaseId);
    if (existing) {
      existing.test = test;
      existing.attempts += 1;
      continue;
    }
    byCaseId.set(test.testCaseId, { test: test, attempts: 1 });
    order.push(test.testCaseId);
  }
  return order.map((id) => byCaseId.get(id)!);
}

function countTests (latestRuns: readonly ILatestRun[]): ICounts {
  const statuses = latestRuns.map((entry) => entry.test.status);
  return {
    total: statuses.length,
    passed: statuses.filter((s) => s === "passed").length,
    failed: statuses.filter((s) => s === "failed").length,
    inconclusive: statuses.filter((s) => s === "inconclusive").length,
  };
}

function statusEmoji (test: TestResult): string {
  if (test.status === "passed") return "✅";
  if (test.status === "failed") return "❌";
  return "⚠️";
}

/** Overall verdict for a report. `none` when there are no tests at all. */
export type Verdict = "pass" | "fail" | "inconclusive" | "none";

/**
 * Strict verdict policy, applied to each test case's latest run:
 * - Any failed test → FAIL (overrides everything else)
 * - Any inconclusive test (with no failures) → INCONCLUSIVE
 * - All passed and at least one test → PASS
 * - Empty report → NONE
 *
 * A test case that failed and then passed on a rerun contributes its pass, since
 * the rerun is the result that stands.
 */
export function computeVerdict (report: E2eReport): Verdict {
  const latestRuns = resolveLatestRuns(report.tests);
  if (latestRuns.length === 0) return "none";
  if (latestRuns.some((entry) => entry.test.status === "failed")) return "fail";
  if (latestRuns.some((entry) => entry.test.status === "inconclusive")) return "inconclusive";
  return "pass";
}

function verdictLabel (verdict: Verdict): string | null {
  switch (verdict) {
    case "pass": return "✅ PASS";
    case "fail": return "❌ FAIL";
    case "inconclusive": return "⚠️ INCONCLUSIVE";
    case "none": return null;
  }
}

/** Verdict and counts on one line, so the summary opens with the whole outcome. */
function renderSummaryHeadline (verdict: Verdict, counts: ICounts): string {
  const { total, passed, failed, inconclusive } = counts;
  const tally = `${total} ${total === 1 ? "test" : "tests"} ran · ${passed} passed / ${failed} failed / ${inconclusive} inconclusive`;
  const label = verdictLabel(verdict);
  return label ? `**${label}** — ${tally}` : `**${tally}**`;
}

/** The "ending screenshot" step for a test: failure-step for failed, last step for passed/inconclusive. */
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

/**
 * Position of the failing step in `steps[]`, 1-based.
 *
 * Producers disagree on whether `stepIndex` counts from 0 or 1, so the ordinal
 * comes from the step's place in the array — the same basis as the rendered step
 * list and the step count. Falls back to the raw index when no step carries it.
 */
function failureOrdinal (test: TestResult, failureStepIndex: number): number {
  const position = test.steps.findIndex((s) => s.stepIndex === failureStepIndex);
  return position === -1 ? failureStepIndex : position + 1;
}

/** Default caption text used when the caller doesn't provide one. */
function defaultEndingCaption (test: TestResult): string {
  if (test.status === "failed") {
    return `Failure at step ${failureOrdinal(test, test.failureStepIndex)}`;
  }
  if (test.status === "inconclusive") {
    return "Last frame before run was cut short";
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

/** Escape backticks in free text so inline-code formatting stays balanced. */
function safeInlineCode (s: string): string {
  // Replace backticks with the visually-similar U+2018/U+2019 so the surrounding
  // inline-code markers don't get closed early.
  return s.replace(/`/g, "‘");
}

/**
 * Render the summary section: header, verdict headline, and the per-test
 * numbered name list (grouped by useCaseName when any test has one, otherwise
 * flat). Numbering is global across groups so it matches the details blocks.
 */
export function renderOverview (report: E2eReport): string {
  const latestRuns = resolveLatestRuns(report.tests);
  const counts = countTests(latestRuns);
  const lines: string[] = [
    "## E2E Acceptance Results",
    "",
    "### Summary",
    "",
    renderSummaryHeadline(computeVerdict(report), counts),
  ];
  if (counts.total === 0) {
    lines.push("", "_No tests were executed._");
    return lines.join("\n");
  }
  lines.push("");
  const numbering = buildTestNumbering(latestRuns);
  const anyGrouped = latestRuns.some((entry) => Boolean(entry.test.useCaseName));
  if (!anyGrouped) {
    for (const entry of latestRuns) {
      lines.push(renderOverviewBullet(entry, numbering, ""));
    }
    return lines.join("\n");
  }
  for (const entry of buildGroupedLayout(latestRuns)) {
    if (entry.type === "test") {
      lines.push(renderOverviewBullet(entry.entry, numbering, ""));
    } else {
      lines.push(`- **${entry.key}**`);
      for (const member of entry.members) {
        lines.push(renderOverviewBullet(member, numbering, "  "));
      }
    }
  }
  return lines.join("\n");
}

/**
 * Assign each test case its 1-based position after repeated runs collapse, so
 * the summary list and the details blocks carry the same ordinals.
 */
function buildTestNumbering (latestRuns: readonly ILatestRun[]): Map<string, number> {
  const map = new Map<string, number>();
  latestRuns.forEach((entry, i) => {
    map.set(entry.test.testCaseId, i + 1);
  });
  return map;
}

/** One summary bullet, state-first so the list scans by outcome. */
function renderOverviewBullet (
  entry: ILatestRun,
  numbering: Map<string, number>,
  indent: string,
): string {
  const rerunNote = entry.attempts > 1 ? ` _(${entry.attempts} runs)_` : "";
  return `${indent}- ${statusEmoji(entry.test)} **${numbering.get(entry.test.testCaseId)}.** ${entry.test.name}${rerunNote}`;
}

/** A use-case group and its members, or a single ungrouped test at its report position. */
type GroupedEntry =
  | { type: "group"; key: string; members: ILatestRun[] }
  | { type: "test"; entry: ILatestRun };

/**
 * Preserve first-seen order of use case groups; ungrouped tests are emitted as
 * top-level bullets interleaved at their position in the report.
 */
function buildGroupedLayout (latestRuns: readonly ILatestRun[]): GroupedEntry[] {
  const groups = new Map<string, ILatestRun[]>();
  const layout: GroupedEntry[] = [];
  for (const entry of latestRuns) {
    const useCaseName = entry.test.useCaseName;
    if (!useCaseName) {
      layout.push({ type: "test", entry: entry });
      continue;
    }
    const existing = groups.get(useCaseName);
    if (existing) {
      existing.push(entry);
      continue;
    }
    const members = [entry];
    groups.set(useCaseName, members);
    layout.push({ type: "group", key: useCaseName, members: members });
  }
  return layout;
}

/**
 * Render one `<details>` block for a test case.
 *
 * `testNumber` is the 1-based index used to prefix the collapsible summary line
 * so it lines up with the numbered list in the summary section. Block order is
 * result first, evidence last: the verdict and its reason, the step reference
 * line and step list, then the ending screenshot.
 */
export function renderTestDetails (
  entry: ILatestRun,
  projectId: string,
  testNumber: number,
  dashboardBaseUrl: string = DASHBOARD_URL_BASE,
): string {
  const { test } = entry;
  const body: string[] = ["", "<br>", ""];
  body.push(...renderResultSummary(entry, projectId, dashboardBaseUrl));
  const stepList = renderStepList(test.steps);
  if (stepList) {
    body.push("", ...stepList);
  }
  const frameBlock = renderEndingFrame(test);
  if (frameBlock) {
    body.push("", ...frameBlock);
  }
  return `<details>\n<summary>${renderSummaryLine(test, testNumber)}</summary>\n${body.join("\n")}\n\n</details>`;
}

/**
 * The collapsible's visible line: status emoji first so the outcome reads while
 * collapsed. GitHub draws its own disclosure triangle, so none is written here.
 */
function renderSummaryLine (test: TestResult, testNumber: number): string {
  const base = `${statusEmoji(test)} <b>${testNumber}. ${test.name}</b>`;
  return test.description ? `${base} — ${test.description}` : base;
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

/**
 * Render the run's steps as a numbered list, eliding the middle of a long run
 * so the block stays scannable and the byte budget survives. Ordinals come from
 * array position, matching the step count on the reference line above. Returns
 * null when the run recorded no steps.
 *
 * Output shape: `["1. Open profile", "", "_… 41 more steps …_", "", "48. Submit"]`
 */
function renderStepList (steps: readonly Step[]): string[] | null {
  if (steps.length === 0) {
    return null;
  }
  const entry = (step: Step, position: number): string => `${position}. ${safeInlineCode(step.action)}`;
  if (steps.length <= STEP_LIST_ELISION_THRESHOLD) {
    return steps.map((step, i) => entry(step, i + 1));
  }
  const head = steps.slice(0, STEP_LIST_HEAD_COUNT).map((step, i) => entry(step, i + 1));
  const tailStart = steps.length - STEP_LIST_TAIL_COUNT;
  const tail = steps.slice(tailStart).map((step, i) => entry(step, tailStart + i + 1));
  const hidden = tailStart - STEP_LIST_HEAD_COUNT;
  return [...head, "", `_… ${hidden} more steps …_`, "", ...tail];
}

function renderResultSummary (
  entry: ILatestRun,
  projectId: string,
  dashboardBaseUrl: string,
): string[] {
  const { test } = entry;
  const dashboardUrl = `${dashboardBaseUrl}/${projectId}/scripts?modal=script-details&testCaseId=${encodeURIComponent(test.testCaseId)}`;
  const lines: string[] = [];
  if (test.status === "passed") {
    lines.push(`**Result:** ✅ PASSED`);
  } else if (test.status === "failed") {
    lines.push(`**Result:** ❌ FAILED at step ${failureOrdinal(test, test.failureStepIndex)}`);
    lines.push(`**Error:** \`${safeInlineCode(test.error)}\``);
  } else {
    lines.push(`**Result:** ⚠️ INCONCLUSIVE`);
    lines.push(`**Reason:** \`${safeInlineCode(test.reason)}\``);
  }
  if (entry.attempts > 1) {
    lines.push(`**Runs:** ${entry.attempts} — showing the latest`);
  }
  lines.push(`**Steps:** ${test.steps.length} · <a href="${dashboardUrl}" target="_blank" rel="noopener noreferrer">View steps on Muggle AI →</a>`);
  return lines;
}

/** Options shared by both render entry points. */
export interface IDashboardLinkOptions {
  /**
   * Dashboard projects base for the ring this run happened on, without a
   * trailing slash. Omitted falls back to production.
   */
  dashboardBaseUrl?: string;
}

/** Options for renderComment. */
export type IRenderCommentOptions = IDashboardLinkOptions;

/** Options for renderBody. */
export interface IRenderBodyOptions extends IDashboardLinkOptions {
  /**
   * When true, the per-test `<details>` blocks are included inline in the body.
   * When false, a single pointer line is written instead and the details are expected
   * to be posted as an overflow comment by the caller.
   */
  inlineDetails: boolean;
}

function renderDetailBlocks (report: E2eReport, dashboardBaseUrl?: string): string {
  return resolveLatestRuns(report.tests)
    .map((entry, i) =>
      renderTestDetails(entry, report.projectId, i + 1, dashboardBaseUrl ?? DASHBOARD_URL_BASE))
    .join("\n\n");
}

/** Render the full PR-body evidence block (summary + optional per-test details). */
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
  return [
    overview,
    "",
    "---",
    "",
    "### Test details",
    "",
    renderDetailBlocks(report, opts.dashboardBaseUrl),
  ].join("\n");
}

/** Render the overflow comment body. Returns empty string if there are no tests. */
export function renderComment (report: E2eReport, opts: IRenderCommentOptions = {}): string {
  if (report.tests.length === 0) {
    return "";
  }
  return [
    "## E2E acceptance evidence (overflow)",
    "",
    "_This comment was posted because the full per-test details did not fit in the PR description._",
    "",
    "### Test details",
    "",
    renderDetailBlocks(report, opts.dashboardBaseUrl),
  ].join("\n");
}
