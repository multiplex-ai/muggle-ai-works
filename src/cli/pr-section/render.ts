/**
 * Pure markdown emitters for the PR body evidence block and the overflow comment.
 * No I/O, no length measurement, no overflow logic — see overflow.ts for that.
 *
 * Layout (two sections):
 *   1. Summary: verdict headline + the failed/inconclusive cases with why + per-test name list (numbered;
 *      grouped by useCaseName when present).
 *   2. Test details: one <details> block per test case, in report order, holding a
 *      result table, one collapsible per step with its screenshot, and the ending screen.
 *
 * A test case that ran more than once at one runSettings record collapses to a
 * single entry carrying its latest run; see resolveLatestRuns.
 */

import {
  DETAIL_IMAGE_WIDTH,
  SHORT_ID_LABEL_SEPARATOR,
  STEP_ELEMENT_ID_SUFFIX,
  STEP_IMAGE_WIDTH,
  STEP_LIST_ELISION_THRESHOLD,
  STEP_LIST_HEAD_COUNT,
  STEP_LIST_TAIL_COUNT,
  STEP_PAIR_IMAGE_WIDTH,
  STEP_SCREENSHOT_MARKER,
  TEST_DETAILS_ANCHOR_PREFIX,
  TEST_DETAILS_DIVIDER,
} from "./constants.js";
import {
  escapeHtml,
  escapeHtmlAttribute,
  renderUnpassedCaseBullet,
  withResolutionLabel,
} from "../../e2e-result/format.js";
import { renderE2eResultMarker } from "../../e2e-result/marker.js";
import type { IE2eResultRecord } from "../../e2e-result/types.js";
import { buildE2eResultRecord, failureOrdinal } from "./result-record.js";
import { StepScreenshotDetailEnum, type E2eReport, type Step, type TestResult } from "./types.js";

/** A test case at one runSettings record reduced to its latest run, plus how many runs it had. */
export interface ILatestRun {
  /** The most recent run recorded for this test case and record. */
  test: TestResult;
  /** Total runs recorded for the test case and record, including the one rendered. */
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

/** What tells one walkthrough entry from another: the test case and, when the report names it, its record. */
type WalkthroughEntryIdentity = Pick<TestResult, "testCaseId" | "runSettingsId">;

/**
 * The key repeated runs collapse on: the test case and the runSettings record it ran at, or the test case alone
 * for an entry that names no record.
 *
 * Output shape: `tc-1-rs-390` / `tc-1`
 */
function walkthroughEntryKey (identity: WalkthroughEntryIdentity): string {
  return identity.runSettingsId ? `${identity.testCaseId}-${identity.runSettingsId}` : identity.testCaseId;
}

/**
 * Collapse repeated runs of the same test case at the same runSettings record to one entry holding the latest.
 *
 * A report legitimately repeats a testCaseId when a run is followed by a rerun.
 * Listing each run separately shows the reader the same test case twice and
 * counts it twice, so the last occurrence — the outcome that currently stands —
 * replaces the earlier ones. Runs naming different records (two resolutions of
 * one test case) are separate entries, each verified on its own. Entries keep
 * their first-seen position so the ordering stays stable when a rerun is appended.
 *
 * Output shape: `[{ test, attempts: 2 }, { test, attempts: 1 }]`
 */
export function resolveLatestRuns (tests: readonly TestResult[]): ILatestRun[] {
  const byEntryKey = new Map<string, ILatestRun>();
  const order: string[] = [];
  for (const test of tests) {
    const entryKey = walkthroughEntryKey(test);
    const existing = byEntryKey.get(entryKey);
    if (existing) {
      existing.test = test;
      existing.attempts += 1;
      continue;
    }
    byEntryKey.set(entryKey, { test: test, attempts: 1 });
    order.push(entryKey);
  }
  return order.map((entryKey) => byEntryKey.get(entryKey)!);
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

/**
 * A screenshot at its original resolution, shrunk only by `width` and left bare: GitHub wraps it in a link to
 * itself that opens the full-size image in a new tab, while a link of our own would open in the same tab because
 * GitHub strips its `target`. The alt text can be a test name carrying a quote — unescaped, it closes the
 * attribute early and GitHub prints the whole tag as text instead of the screenshot.
 */
function screenshotImage (url: string, displayWidth: number, alt: string): string {
  return `<img src="${url}" width="${displayWidth}" alt="${escapeHtmlAttribute(alt)}">`;
}

/** Fit free text into one table cell: a line break or a bare pipe would end the row. */
function tableCell (s: string): string {
  return s.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
}

/** What a step did, in the agent's words when it gave them, else the operation verb. */
function stepText (step: Step): string {
  return escapeHtml((step.description ?? step.action).replace(STEP_ELEMENT_ID_SUFFIX, ""));
}

/** A short ID, when present, in front of the text it labels: `TC-42 · Checkout`. */
function withShortId (shortId: string | undefined, labelledText: string): string {
  return shortId ? `${shortId}${SHORT_ID_LABEL_SEPARATOR}${labelledText}` : labelledText;
}

/** How the summary and the details name a test: `TC-42 · Checkout (390×844)`. */
function testLabel (test: TestResult): string {
  return withResolutionLabel(withShortId(test.testCaseShortId, test.name), test.resolutionLabel);
}

/**
 * Link to the run on the dashboard it was published to. The run's own `viewUrl` names that ring and pins this
 * run; a link rebuilt from the renderer's runtime target can point at another ring, or at localhost.
 */
function dashboardLink (test: TestResult): string {
  return `<a href="${escapeHtmlAttribute(test.viewUrl)}" target="_blank" rel="noopener noreferrer">Open the full run on Muggle AI →</a>`;
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
  const numbering = buildTestNumbering(latestRuns);
  lines.push(...renderNeedsAttention(buildE2eResultRecord(latestRuns.map((entry) => entry.test))));
  lines.push("");
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
      lines.push(...renderUseCaseGroup(entry.key, entry.members, numbering));
    }
  }
  return lines.join("\n");
}

/**
 * The failed and inconclusive cases with why each did not pass, so a reader learns what to fix before reaching
 * the full list. Empty when every case passed.
 */
function renderNeedsAttention (record: IE2eResultRecord): string[] {
  if (record.unpassed.length === 0) return [];
  return [
    "",
    "**Needs attention**",
    "",
    ...record.unpassed.map((unpassed) =>
      renderUnpassedCaseBullet(unpassed, "see details", `#${testAnchor(unpassed)}`)),
  ];
}

/**
 * One use case as a collapsible group whose label carries its tally. A group with a failure or an inconclusive
 * test starts open, so a problem is never hidden behind a click; an all-passed group starts closed.
 */
function renderUseCaseGroup (
  useCaseName: string,
  members: readonly ILatestRun[],
  numbering: Map<string, number>,
): string[] {
  const groupCounts = countTests(members);
  const isAllPassed = groupCounts.passed === groupCounts.total;
  const tally = [
    groupCounts.passed > 0 ? `✅ ${groupCounts.passed} passed` : null,
    groupCounts.failed > 0 ? `❌ ${groupCounts.failed} failed` : null,
    groupCounts.inconclusive > 0 ? `⚠️ ${groupCounts.inconclusive} inconclusive` : null,
  ].filter((part): part is string => part !== null).join(" · ");
  return [
    "",
    `<details${isAllPassed ? "" : " open"}><summary><b>${escapeHtml(useCaseName)}</b> — ${tally}</summary>`,
    ...indented(members.map((member) => renderOverviewBullet(member, numbering, ""))),
    "</details>",
  ];
}

/**
 * Assign each entry its 1-based position after repeated runs collapse, so
 * the summary list and the details blocks carry the same ordinals.
 */
function buildTestNumbering (latestRuns: readonly ILatestRun[]): Map<string, number> {
  const ordinalByEntryKey = new Map<string, number>();
  latestRuns.forEach((entry, i) => {
    ordinalByEntryKey.set(walkthroughEntryKey(entry.test), i + 1);
  });
  return ordinalByEntryKey;
}

/** One summary bullet, state-first so the list scans by outcome. */
function renderOverviewBullet (
  entry: ILatestRun,
  numbering: Map<string, number>,
  indent: string,
): string {
  const rerunNote = entry.attempts > 1 ? ` _(${entry.attempts} runs)_` : "";
  const detailsLink = ` · [see details](#${testAnchor(entry.test)})`;
  return `${indent}- ${statusEmoji(entry.test)} **${numbering.get(walkthroughEntryKey(entry.test))}.** ${testLabel(entry.test)}${rerunNote}${detailsLink}`;
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
 * Render one test case: a heading, its description, the result table, then one
 * collapsible holding the steps and the ending screenshot.
 *
 * The heading sits outside any <details>. GitHub lays a heading placed inside a
 * <summary> out inline-block, so a title too long for one line wraps as a whole
 * below the disclosure triangle and leaves the triangle alone on a line — and
 * test titles are usually full sentences. Out here it is a plain heading, and
 * the result stays readable without expanding anything.
 *
 * `testNumber` is the 1-based index that lines the heading up with the numbered
 * list in the summary section.
 */
export function renderTestDetails (
  entry: ILatestRun,
  testNumber: number,
  screenshotDetail: StepScreenshotDetailEnum = StepScreenshotDetailEnum.BeforeAndAfter,
): string {
  const { test } = entry;
  const lines: string[] = [`<a name="${testAnchor(test)}"></a>`, "", `#### ${statusEmoji(test)} ${testNumber}. ${testLabel(test)}`, ""];
  if (test.description && !isSameText(test.description, test.name)) {
    lines.push(`_${test.description.replace(/\s*\n\s*/g, " ")}_`, "");
  }
  lines.push(...renderResultTable(entry));
  const steps = renderSteps(test, screenshotDetail) ?? [];
  const frame = renderEndingFrame(test) ?? [];
  const evidence = [...steps, ...(steps.length > 0 && frame.length > 0 ? [""] : []), ...frame];
  if (evidence.length > 0) {
    lines.push("", `<details><summary>${evidenceToggleLabel(test, screenshotDetail)}</summary>`, ...indented(evidence), "</details>");
  }
  return lines.join("\n");
}

/**
 * Wrap a collapsible's content in a definition-list body, the one indenting element GitHub keeps that does not
 * also dim its text, so what a toggle reveals sits visibly under it. The blank lines let markdown inside render.
 */
function indented (content: readonly string[]): string[] {
  return ["<dl><dd>", "", ...content, "", "</dd></dl>"];
}

/**
 * The in-page anchor on a test's details, which its summary line links to. Keyed like the entry itself — test
 * case plus record — so it stays unique on the PR page and resolves whether the details are inline or in the
 * overflow comment.
 */
function testAnchor (identity: WalkthroughEntryIdentity): string {
  return `${TEST_DETAILS_ANCHOR_PREFIX}${walkthroughEntryKey(identity)}`;
}

/**
 * The collapsible's label, drawn as a key cap — one of the few boxed styles GitHub keeps — so it reads as
 * something to press without hovering, and says what pressing it reveals.
 */
function evidenceToggleLabel (test: TestResult, screenshotDetail: StepScreenshotDetailEnum): string {
  const count = test.steps.length;
  if (count === 0) {
    return "<kbd>Show the ending screen</kbd>";
  }
  const stepCount = `${count} ${count === 1 ? "step" : "steps"}`;
  return screenshotDetail === StepScreenshotDetailEnum.None
    ? `<kbd>Show ${stepCount}</kbd>`
    : `<kbd>Show ${stepCount} and screenshots</kbd>`;
}

/** Whether two texts say the same thing once case, spacing and trailing punctuation are set aside. */
function isSameText (left: string, right: string): boolean {
  const normalize = (text: string): string => text.trim().replace(/[\s.!?]+$/, "").replace(/\s+/g, " ").toLowerCase();
  return normalize(left) === normalize(right);
}

/**
 * Render the ending-frame block: a caption line identifying what the screenshot
 * shows, followed by the clickable full-width image. Returns null if there is
 * nothing to render (e.g. an empty-steps passed test with no endingScreenshotUrl
 * override).
 */
function renderEndingFrame (test: TestResult): string[] | null {
  const frame = endingFrame(test);
  if (!frame) {
    return null;
  }
  return [
    `**Ending screen** — ${frame.caption}`,
    "",
    screenshotImage(frame.url, DETAIL_IMAGE_WIDTH, test.name),
  ];
}

/**
 * A step's screenshots: the page before and after it acted, side by side under labels, or the before alone when
 * the report carries no after or the comment has no room for it.
 */
function renderStepScreenshots (step: Step, position: number, screenshotDetail: StepScreenshotDetailEnum): string[] {
  if (!step.afterScreenshotUrl || screenshotDetail === StepScreenshotDetailEnum.BeforeOnly) {
    return [screenshotImage(step.screenshotUrl, STEP_IMAGE_WIDTH, `Step ${position}`)];
  }
  return [
    "| Before | After |",
    "|:--|:--|",
    `| ${screenshotImage(step.screenshotUrl, STEP_PAIR_IMAGE_WIDTH, `Step ${position} before`)} ` +
      `| ${screenshotImage(step.afterScreenshotUrl, STEP_PAIR_IMAGE_WIDTH, `Step ${position} after`)} |`,
  ];
}

/**
 * Render the run's steps, one collapsible each that opens onto that step's
 * screenshot — a comment runs no script, so a native <details> is the only
 * interaction available. Past the threshold the middle is elided with a pointer
 * to the full run. Ordinals come from array position, so the tail reads as the
 * run's real step numbers. Returns null when the run recorded no steps.
 */
function renderSteps (
  test: TestResult,
  screenshotDetail: StepScreenshotDetailEnum,
): string[] | null {
  const { steps } = test;
  if (steps.length === 0) {
    return null;
  }
  const isTextOnly = screenshotDetail === StepScreenshotDetailEnum.None;
  const collapsible = (step: Step, position: number): string =>
    isTextOnly
      ? `- ${position} · ${stepText(step)}`
      : [
          `<details><summary>${STEP_SCREENSHOT_MARKER} ${position} · ${stepText(step)}</summary>`,
          ...indented(renderStepScreenshots(step, position, screenshotDetail)),
          "</details>",
        ].join("\n");
  const heading = isTextOnly ? ["**Steps**", ""] : ["**Steps** — click a step to see its screenshots", ""];
  if (steps.length <= STEP_LIST_ELISION_THRESHOLD) {
    return [...heading, ...steps.map((step, i) => collapsible(step, i + 1))];
  }
  const tailStart = steps.length - STEP_LIST_TAIL_COUNT;
  const hidden = tailStart - STEP_LIST_HEAD_COUNT;
  return [
    ...heading,
    ...steps.slice(0, STEP_LIST_HEAD_COUNT).map((step, i) => collapsible(step, i + 1)),
    "",
    `_… ${hidden} more ${hidden === 1 ? "step" : "steps"} — ${dashboardLink(test)}_`,
    "",
    ...steps.slice(tailStart).map((step, i) => collapsible(step, tailStart + i + 1)),
  ];
}

/** The run's outcome as a two-column table, so each label stands apart from its value. */
function renderResultTable (entry: ILatestRun): string[] {
  const { test } = entry;
  // GFM requires a header row; the result fills it, rather than an empty row that renders as a blank band.
  const rows: string[] = [];
  if (test.status === "passed") {
    rows.push("| **Result** | ✅ Passed |", "|:--|:--|");
  } else if (test.status === "failed") {
    rows.push(`| **Result** | ❌ Failed at step ${failureOrdinal(test, test.failureStepIndex)} |`, "|:--|:--|");
    rows.push(`| **Why** | ${tableCell(escapeHtml(test.error))} |`);
  } else {
    rows.push("| **Result** | ⚠️ Inconclusive |", "|:--|:--|");
    rows.push(`| **Why** | ${tableCell(escapeHtml(test.reason))} |`);
  }
  if (entry.attempts > 1) {
    rows.push(`| **Attempts** | ${entry.attempts} — showing the latest |`);
  }
  const count = test.steps.length;
  const runSummary = withShortId(test.replayShortId, `${count} browser ${count === 1 ? "step" : "steps"}`);
  rows.push(`| **Run** | ${runSummary} · ${dashboardLink(test)} |`);
  return rows;
}

/** Options for renderComment. */
export interface IRenderCommentOptions {
  /** How much of each step's screenshots to include; omitted means before and after. */
  screenshotDetail?: StepScreenshotDetailEnum;
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

function renderDetailBlocks (
  report: E2eReport,
  screenshotDetail: StepScreenshotDetailEnum = StepScreenshotDetailEnum.BeforeAndAfter,
): string {
  return resolveLatestRuns(report.tests)
    .map((entry, i) => renderTestDetails(entry, i + 1, screenshotDetail))
    .join(`\n\n${TEST_DETAILS_DIVIDER}\n\n`);
}

/**
 * Render the full PR-body evidence block (summary + optional per-test details).
 *
 * Opens with the hidden result record, which is what lets the walkthrough CI check fail on a non-passing run
 * without parsing the markdown.
 */
export function renderBody (report: E2eReport, opts: IRenderBodyOptions): string {
  const resultMarker = renderE2eResultMarker(
    buildE2eResultRecord(resolveLatestRuns(report.tests).map((entry) => entry.test)),
  );
  const overview = `${resultMarker}\n${renderOverview(report)}`;
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
    renderDetailBlocks(report),
  ].join("\n");
}

/** Render the overflow comment body. Returns empty string if there are no tests. */
export function renderComment (report: E2eReport, opts: IRenderCommentOptions = {}): string {
  if (report.tests.length === 0) {
    return "";
  }
  const screenshotDetail = opts.screenshotDetail ?? StepScreenshotDetailEnum.BeforeAndAfter;
  return [
    "## E2E acceptance evidence (overflow)",
    "",
    "_This comment was posted because the full per-test details did not fit in the PR description._",
    ...(screenshotDetail === StepScreenshotDetailEnum.BeforeAndAfter
      ? []
      : ["", "_Step screenshots are trimmed to fit GitHub's comment size limit — open a run on Muggle AI for all of them._"]),
    "",
    "### Test details",
    "",
    renderDetailBlocks(report, screenshotDetail),
  ].join("\n");
}
