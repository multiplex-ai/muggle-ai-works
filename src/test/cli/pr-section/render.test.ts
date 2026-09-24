import { describe, it, expect } from "vitest";

import { DASHBOARD_URL_BASE } from "../../../cli/pr-section/constants.js";
import {
  computeVerdict,
  renderOverview,
  renderTestDetails,
  renderBody,
  renderComment,
  resolveLatestRuns,
  type ILatestRun,
} from "../../../cli/pr-section/render.js";
import type { E2eReport, FailedTest, InconclusiveTest, PassedTest, Step, TestResult } from "../../../cli/pr-section/types.js";

const PROJECT_ID = "p1";
const CHECKOUT_USE_CASE = "Checkout";
const OVERVIEW_ORDINAL = /\*\*\d+\.\*\*/g;
const DETAILS_ORDINAL = /<b>\d+\. /g;

/** Pull the rendered test ordinals out of a markdown chunk, in document order. */
function ordinalsFrom (markdown: string, pattern: RegExp): number[] {
  return (markdown.match(pattern) ?? []).map((token) => Number(token.replace(/[^0-9]/g, "")));
}

/** Wrap a single test as the collapsed-run entry renderTestDetails consumes. */
function latest (test: TestResult, attempts = 1): ILatestRun {
  return { test: test, attempts: attempts };
}

/** Build `count` sequential steps so elision boundaries can be exercised. */
function buildSteps (count: number): Step[] {
  return Array.from({ length: count }, (_, i) => ({
    stepIndex: i,
    action: `Action ${i + 1}`,
    screenshotUrl: `https://cdn/long-${i}.png`,
  }));
}

const passedWithDesc: PassedTest = {
  name: "User creates a new project with valid URL",
  description: "Verify that a logged-in user can create a new project by entering a valid project name and URL.",
  useCaseName: "Create a New Project",
  testCaseId: "tc-1",
  runId: "run-1",
  viewUrl: "https://www.muggle-ai.com/x/run-1",
  status: "passed",
  steps: [
    { stepIndex: 0, action: "Open dashboard", screenshotUrl: "https://cdn/1-0.png" },
    { stepIndex: 1, action: "Click New Project", screenshotUrl: "https://cdn/1-1.png" },
    { stepIndex: 2, action: "Submit", screenshotUrl: "https://cdn/1-2.png" },
  ],
};

const failedWithDesc: FailedTest = {
  name: "User receives error for invalid URL format",
  description: "Verify invalid URL shows an inline validation error.",
  useCaseName: "Create a New Project",
  testCaseId: "tc-2",
  runId: "run-2",
  viewUrl: "https://www.muggle-ai.com/x/run-2",
  status: "failed",
  failureStepIndex: 3,
  error: "Element not found: submit button",
  steps: [
    { stepIndex: 0, action: "Open dashboard", screenshotUrl: "https://cdn/2-0.png" },
    { stepIndex: 1, action: "Click New Project", screenshotUrl: "https://cdn/2-1.png" },
    { stepIndex: 2, action: "Enter invalid URL", screenshotUrl: "https://cdn/2-2.png" },
    { stepIndex: 3, action: "Click Submit", screenshotUrl: "https://cdn/2-3.png" },
  ],
};

const passedAuthGroup: PassedTest = {
  name: "Login with valid credentials",
  description: "Verify a returning user can log in with correct email and password.",
  useCaseName: "User Authentication",
  testCaseId: "tc-3",
  runId: "run-3",
  viewUrl: "https://www.muggle-ai.com/x/run-3",
  status: "passed",
  steps: [
    { stepIndex: 0, action: "Open /login", screenshotUrl: "https://cdn/3-0.png" },
    { stepIndex: 1, action: "Click Sign In", screenshotUrl: "https://cdn/3-1.png" },
  ],
};

const passedNoMeta: PassedTest = {
  name: "Logout flow",
  testCaseId: "tc-4",
  runId: "run-4",
  viewUrl: "https://www.muggle-ai.com/x/run-4",
  status: "passed",
  steps: [
    { stepIndex: 0, action: "Click user menu", screenshotUrl: "https://cdn/4-0.png" },
    { stepIndex: 1, action: "Click Logout", screenshotUrl: "https://cdn/4-1.png" },
  ],
};

const failedNoMeta: FailedTest = {
  name: "Checkout breaks",
  testCaseId: "tc-5",
  runId: "run-5",
  viewUrl: "https://www.muggle-ai.com/x/run-5",
  status: "failed",
  failureStepIndex: 1,
  error: "Timeout waiting for `button[data-id='confirm']`",
  steps: [
    { stepIndex: 0, action: "Add item", screenshotUrl: "https://cdn/5-0.png" },
    { stepIndex: 1, action: "Confirm", screenshotUrl: "https://cdn/5-1.png" },
  ],
};

const inconclusiveWithDesc: InconclusiveTest = {
  name: "Clear search input restores full list",
  description: "Verify clearing the search input restores all options.",
  useCaseName: "Filter Dropdowns",
  testCaseId: "tc-6",
  runId: "run-6",
  viewUrl: "https://www.muggle-ai.com/x/run-6",
  status: "inconclusive",
  reason: "No replayable script exists yet — needs first generation run.",
  steps: [],
};

const inconclusiveWithSteps: InconclusiveTest = {
  name: "Pre-checkout banner inconclusive",
  testCaseId: "tc-7",
  runId: "run-7",
  viewUrl: "https://www.muggle-ai.com/x/run-7",
  status: "inconclusive",
  reason: "Environment precondition unmet: cookie banner stale on this branch.",
  steps: [
    { stepIndex: 0, action: "Open cart", screenshotUrl: "https://cdn/7-0.png" },
    { stepIndex: 1, action: "Hit cookie banner", screenshotUrl: "https://cdn/7-1.png" },
  ],
};

// A failed run and its rerun carry the same testCaseId: the ordinary shape of a
// report assembled after a retry.
const rerunFirstAttempt: FailedTest = {
  name: "Checkout completes with a saved card",
  testCaseId: "tc-8",
  runId: "run-8a",
  viewUrl: "https://www.muggle-ai.com/x/run-8a",
  status: "failed",
  failureStepIndex: 2,
  error: "Timed out waiting for the confirmation banner",
  steps: [
    { stepIndex: 0, action: "Open cart", screenshotUrl: "https://cdn/8a-0.png" },
    { stepIndex: 1, action: "Pay", screenshotUrl: "https://cdn/8a-1.png" },
    { stepIndex: 2, action: "Await confirmation", screenshotUrl: "https://cdn/8a-2.png" },
  ],
};

const rerunSecondAttempt: PassedTest = {
  name: "Checkout completes with a saved card (rerun)",
  testCaseId: "tc-8",
  runId: "run-8b",
  viewUrl: "https://www.muggle-ai.com/x/run-8b",
  status: "passed",
  steps: [
    { stepIndex: 0, action: "Open cart", screenshotUrl: "https://cdn/8b-0.png" },
    { stepIndex: 1, action: "Pay", screenshotUrl: "https://cdn/8b-1.png" },
    { stepIndex: 2, action: "Await confirmation", screenshotUrl: "https://cdn/8b-2.png" },
  ],
};

const flatRerunReport: E2eReport = {
  projectId: PROJECT_ID,
  tests: [passedNoMeta, rerunFirstAttempt, rerunSecondAttempt, failedNoMeta],
};

const groupedRerunReport: E2eReport = {
  projectId: PROJECT_ID,
  tests: [
    passedWithDesc,
    { ...rerunFirstAttempt, useCaseName: CHECKOUT_USE_CASE },
    { ...rerunSecondAttempt, useCaseName: CHECKOUT_USE_CASE },
    passedAuthGroup,
  ],
};

const groupedReport: E2eReport = {
  projectId: PROJECT_ID,
  tests: [passedWithDesc, failedWithDesc, passedAuthGroup],
};

const mixedWithInconclusiveReport: E2eReport = {
  projectId: PROJECT_ID,
  tests: [passedWithDesc, passedAuthGroup, inconclusiveWithDesc],
};

const flatReport: E2eReport = {
  projectId: PROJECT_ID,
  tests: [passedNoMeta, failedNoMeta],
};

const allPassedWithDesc: E2eReport = {
  projectId: PROJECT_ID,
  tests: [passedWithDesc, passedAuthGroup],
};

const allPassedNoMeta: E2eReport = {
  projectId: PROJECT_ID,
  tests: [passedNoMeta],
};

const emptyReport: E2eReport = { projectId: PROJECT_ID, tests: [] };

describe("resolveLatestRuns", () => {
  it("keeps a single run untouched with an attempt count of one", () => {
    const resolved = resolveLatestRuns([passedNoMeta, failedNoMeta]);
    expect(resolved).toHaveLength(2);
    expect(resolved.map((e) => e.attempts)).toEqual([1, 1]);
    expect(resolved[0].test).toBe(passedNoMeta);
  });

  it("collapses a repeated testCaseId onto the last run and counts the attempts", () => {
    const resolved = resolveLatestRuns(flatRerunReport.tests);
    expect(resolved).toHaveLength(3);
    const checkout = resolved.find((e) => e.test.testCaseId === "tc-8")!;
    expect(checkout.test).toBe(rerunSecondAttempt);
    expect(checkout.attempts).toBe(2);
  });

  it("holds a collapsed entry at the position of its first run", () => {
    const resolved = resolveLatestRuns(flatRerunReport.tests);
    expect(resolved.map((e) => e.test.testCaseId)).toEqual(["tc-4", "tc-8", "tc-5"]);
  });

  it("returns an empty list for a report with no tests", () => {
    expect(resolveLatestRuns([])).toEqual([]);
  });
});

describe("computeVerdict", () => {
  it("returns 'none' for an empty report", () => {
    expect(computeVerdict({ projectId: PROJECT_ID, tests: [] })).toBe("none");
  });

  it("returns 'pass' when every test passed", () => {
    expect(computeVerdict({ projectId: PROJECT_ID, tests: [passedWithDesc, passedAuthGroup] })).toBe("pass");
  });

  it("returns 'fail' when any test failed (even with inconclusives)", () => {
    expect(
      computeVerdict({
        projectId: PROJECT_ID,
        tests: [passedWithDesc, failedWithDesc, inconclusiveWithDesc],
      }),
    ).toBe("fail");
  });

  it("returns 'inconclusive' when there are no failures but at least one inconclusive", () => {
    expect(computeVerdict(mixedWithInconclusiveReport)).toBe("inconclusive");
  });

  it("rules on the rerun, so a failure followed by a passing rerun does not fail the report", () => {
    expect(computeVerdict(groupedRerunReport)).toBe("pass");
  });
});

describe("renderOverview", () => {
  it("renders the summary heading, a one-line verdict headline, and a flat state-first list", () => {
    const md = renderOverview(flatReport);
    expect(md).toContain("## E2E Acceptance Results");
    expect(md).toContain("### Summary");
    expect(md).toContain("**❌ FAIL** — 2 tests ran · 1 passed / 1 failed / 0 inconclusive");
    expect(md).toContain("- ✅ **1.** Logout flow");
    expect(md).toContain("- ❌ **2.** Checkout breaks");
    // The old stacked verdict/counts/label paragraphs are gone.
    expect(md).not.toContain("**Verdict:");
    expect(md).not.toContain("**Tests run:**");
    // No nested use-case bullets.
    expect(md).not.toMatch(/^- \*\*[A-Za-z]/m);
  });

  it("groups tests by useCaseName with global numbering across groups", () => {
    const md = renderOverview(groupedReport);
    expect(md).toContain("**❌ FAIL** — 3 tests ran · 2 passed / 1 failed / 0 inconclusive");
    expect(md).toContain("- **Create a New Project**");
    expect(md).toContain("  - ✅ **1.** User creates a new project with valid URL");
    expect(md).toContain("  - ❌ **2.** User receives error for invalid URL format");
    expect(md).toContain("- **User Authentication**");
    expect(md).toContain("  - ✅ **3.** Login with valid credentials");
  });

  it("renders an INCONCLUSIVE headline when no failures but any inconclusive test exists", () => {
    const md = renderOverview(mixedWithInconclusiveReport);
    expect(md).toContain("**⚠️ INCONCLUSIVE** — 3 tests ran · 2 passed / 0 failed / 1 inconclusive");
    expect(md).toContain("⚠️ **3.** Clear search input restores full list");
  });

  it("renders a PASS headline when all tests passed", () => {
    const md = renderOverview(allPassedWithDesc);
    expect(md).toContain("**✅ PASS** — 2 tests ran · 2 passed / 0 failed / 0 inconclusive");
  });

  it("counts a rerun test case once and marks how many runs it had", () => {
    const md = renderOverview(flatRerunReport);
    expect(md).toContain("**❌ FAIL** — 3 tests ran · 2 passed / 1 failed / 0 inconclusive");
    expect(md).toContain("- ✅ **2.** Checkout completes with a saved card (rerun) _(2 runs)_");
    // The earlier attempt is not listed as its own entry.
    expect(md).not.toContain("**3.** Checkout completes with a saved card");
  });

  it("uses the singular noun for a one-test report", () => {
    const md = renderOverview(allPassedNoMeta);
    expect(md).toContain("1 test ran ·");
  });

  it("handles an empty report with a friendly placeholder", () => {
    const md = renderOverview(emptyReport);
    expect(md).toContain("## E2E Acceptance Results");
    expect(md).toContain("### Summary");
    expect(md).toContain("**0 tests ran · 0 passed / 0 failed / 0 inconclusive**");
    expect(md).toContain("_No tests were executed._");
    // No verdict label on an empty report — there's nothing to rule on.
    expect(md).not.toContain("PASS");
    expect(md).not.toContain("FAIL");
  });
});

describe("renderTestDetails", () => {
  it("renders a passed test with a state-first summary line and no expand hint", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).toContain("<details>");
    expect(md).toContain("<summary>✅ <b>1. User creates a new project with valid URL</b>");
    expect(md).toContain("— Verify that a logged-in user can create a new project");
    expect(md).not.toContain("click to expand");
    expect(md).toContain("**Result:** ✅ PASSED");
    expect(md).toContain("</details>");
  });

  it("merges the step count and the dashboard link onto one reference line", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    const stepsLine = md.split("\n").find((l) => l.startsWith("**Steps:**"))!;
    expect(stepsLine).toContain("**Steps:** 3 ·");
    expect(stepsLine).toContain("View steps on Muggle AI →");
    expect(stepsLine).toContain(
      "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/p1/scripts?modal=script-details&testCaseId=tc-1",
    );
  });

  it("closes the block with the ending screenshot, after the result and the steps", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).toContain("**📸 Ending screen — Final page after the test completed**");
    expect(md).toContain('<img src="https://cdn/1-2.png" width="720"');
    expect(md.indexOf("**Result:**")).toBeLessThan(md.indexOf("**📸 Ending screen"));
    expect(md.indexOf("**Steps:**")).toBeLessThan(md.indexOf("**📸 Ending screen"));
    expect(md.indexOf("1. Open dashboard")).toBeLessThan(md.indexOf("**📸 Ending screen"));
  });

  it("renders every step of a short run, numbered from one", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).toContain("1. Open dashboard");
    expect(md).toContain("2. Click New Project");
    expect(md).toContain("3. Submit");
    expect(md).not.toContain("more steps");
  });

  it("links into the ring the run happened on when a base is supplied", () => {
    const md = renderTestDetails(
      latest(passedWithDesc),
      PROJECT_ID,
      1,
      "https://staging.muggle-ai.com/muggleTestV0/dashboard/projects",
    );
    expect(md).toContain(
      "https://staging.muggle-ai.com/muggleTestV0/dashboard/projects/p1/scripts?modal=script-details&testCaseId=tc-1",
    );
    // A staging run must not send reviewers to production.
    expect(md).not.toContain("https://www.muggle-ai.com");
  });

  it("falls back to production when no base is supplied", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).toContain(DASHBOARD_URL_BASE);
  });

  it("renders a passed test without description (no em-dash, no description text)", () => {
    const md = renderTestDetails(latest(passedNoMeta), PROJECT_ID, 4);
    expect(md).toContain("<summary>✅ <b>4. Logout flow</b></summary>");
  });

  it("renders a failed test with the error and a position-based failure ordinal", () => {
    const md = renderTestDetails(latest(failedWithDesc), PROJECT_ID, 2);
    expect(md).toContain("<summary>❌ <b>2. User receives error for invalid URL format</b>");
    // failureStepIndex 3 is the fourth step, so it reads as step 4 alongside "Steps: 4".
    expect(md).toContain("**Result:** ❌ FAILED at step 4");
    expect(md).toContain("**Error:** `Element not found: submit button`");
    expect(md).toContain("**Steps:** 4 ·");
    expect(md).toContain("**📸 Ending screen — Failure at step 4**");
    expect(md).toContain('<img src="https://cdn/2-3.png"');
  });

  it("marks how many runs a collapsed test case had, and which one is shown", () => {
    const md = renderTestDetails(latest(rerunSecondAttempt, 2), PROJECT_ID, 2);
    expect(md).toContain("**Runs:** 2 — showing the latest");
  });

  it("omits the runs line for a test case that ran once", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).not.toContain("**Runs:**");
  });

  it("uses endingScreenshotUrl + endingScreenshotCaption when provided on the test", () => {
    const overrideTest: PassedTest = {
      ...passedWithDesc,
      endingScreenshotUrl: "https://cdn/summary.png",
      endingScreenshotCaption: "Success. The goal is achieved.",
    };
    const md = renderTestDetails(latest(overrideTest), PROJECT_ID, 1);
    expect(md).toContain("**📸 Ending screen — Success. The goal is achieved.**");
    expect(md).toContain('<img src="https://cdn/summary.png"');
    expect(md).not.toContain('<img src="https://cdn/1-2.png"');
  });

  it("escapes backticks in the error message so inline code stays balanced", () => {
    const md = renderTestDetails(latest(failedNoMeta), PROJECT_ID, 5);
    expect(md).toContain("**Error:**");
    expect(md).not.toMatch(/Timeout waiting for `button/);
    expect(md).toContain("Timeout waiting for ‘button[data-id='confirm']‘");
    const errorLine = md.split("\n").find((l) => l.startsWith("**Error:**"))!;
    expect(errorLine).toMatch(/^\*\*Error:\*\* `[^`]+`$/);
  });

  it("escapes backticks in a step action so the list cannot open a code span", () => {
    const backtickStep: PassedTest = {
      ...passedNoMeta,
      steps: [{ stepIndex: 0, action: "Click `Submit`", screenshotUrl: "https://cdn/bt-0.png" }],
    };
    const md = renderTestDetails(latest(backtickStep), PROJECT_ID, 1);
    expect(md).toContain("1. Click ‘Submit‘");
    expect(md).not.toContain("Click `Submit`");
  });

  it("renders the dashboard link to open in a new tab", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).toContain("target=\"_blank\"");
    expect(md).toContain("rel=\"noopener noreferrer\"");
  });

  it("renders an inconclusive test with the warning emoji, reason line, and no error", () => {
    const md = renderTestDetails(latest(inconclusiveWithDesc), PROJECT_ID, 3);
    expect(md).toContain("<summary>⚠️ <b>3. Clear search input restores full list</b>");
    expect(md).toContain("**Result:** ⚠️ INCONCLUSIVE");
    expect(md).toContain("**Reason:** `No replayable script exists yet — needs first generation run.`");
    expect(md).not.toContain("**Error:**");
    expect(md).toContain("**Steps:** 0 ·");
    // No ending-screen block and no step list when there are zero steps.
    expect(md).not.toContain("**📸 Ending screen");
    expect(md).toContain(
      "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/p1/scripts?modal=script-details&testCaseId=tc-6",
    );
  });

  it("renders an inconclusive test with steps using a 'cut short' caption", () => {
    const md = renderTestDetails(latest(inconclusiveWithSteps), PROJECT_ID, 4);
    expect(md).toContain("**📸 Ending screen — Last frame before run was cut short**");
    expect(md).toContain('<img src="https://cdn/7-1.png"');
    expect(md).toContain("**Result:** ⚠️ INCONCLUSIVE");
  });
});

describe("step list elision", () => {
  const withSteps = (count: number): ILatestRun =>
    latest({ ...passedNoMeta, steps: buildSteps(count) });

  it("renders all nine steps of a nine-step run", () => {
    const md = renderTestDetails(withSteps(9), PROJECT_ID, 1);
    expect(md).toContain("9. Action 9");
    expect(md).not.toContain("more steps");
  });

  it("renders all ten steps at the threshold", () => {
    const md = renderTestDetails(withSteps(10), PROJECT_ID, 1);
    expect(md).toContain("10. Action 10");
    expect(md).not.toContain("more steps");
  });

  it("elides one step past the threshold, keeping six head and three tail entries", () => {
    const md = renderTestDetails(withSteps(11), PROJECT_ID, 1);
    expect(md).toContain("6. Action 6");
    expect(md).toContain("_… 2 more steps …_");
    expect(md).toContain("9. Action 9");
    expect(md).toContain("11. Action 11");
    expect(md).not.toContain("7. Action 7");
  });

  it("keeps a long run scannable and its tail numbered by true position", () => {
    const md = renderTestDetails(withSteps(50), PROJECT_ID, 1);
    expect(md).toContain("1. Action 1");
    expect(md).toContain("6. Action 6");
    expect(md).toContain("_… 41 more steps …_");
    expect(md).toContain("48. Action 48");
    expect(md).toContain("50. Action 50");
    expect(md).toContain("**Steps:** 50 ·");
  });
});

describe("renderBody", () => {
  it("renders summary + details inline under their own headings", () => {
    const body = renderBody(groupedReport, { inlineDetails: true });
    expect(body).toContain("## E2E Acceptance Results");
    expect(body).toContain("### Summary");
    expect(body).toContain("### Test details");
    expect(body).toContain("- **Create a New Project**");
    expect(body).toContain("---");
    const detailsCount = (body.match(/<details>/g) ?? []).length;
    expect(detailsCount).toBe(3);
  });

  it("renders summary + pointer line when inlineDetails=false", () => {
    const body = renderBody(groupedReport, { inlineDetails: false });
    expect(body).toContain("## E2E Acceptance Results");
    expect(body).toContain("---");
    expect(body).toContain("_Full per-test details in the comment below");
    expect(body).not.toContain("<details>");
    expect(body).not.toContain("### Test details");
  });

  it("renders every passed test as a details block (not just failures)", () => {
    const body = renderBody(allPassedWithDesc, { inlineDetails: true });
    const detailsCount = (body.match(/<details>/g) ?? []).length;
    expect(detailsCount).toBe(2);
  });

  it("renders a flat numbered list when no test has a useCaseName", () => {
    const body = renderBody(allPassedNoMeta, { inlineDetails: true });
    expect(body).toContain("- ✅ **1.** Logout flow");
    expect(body).not.toMatch(/^- \*\*[A-Za-z]/m);
  });

  it("empty report: no details, no horizontal rule", () => {
    const body = renderBody(emptyReport, { inlineDetails: true });
    expect(body).toContain("**0 tests ran · 0 passed / 0 failed / 0 inconclusive**");
    expect(body).toContain("_No tests were executed._");
    expect(body).not.toContain("---");
    expect(body).not.toContain("<details>");
  });
});

describe("renderComment", () => {
  it("renders a comment with one <details> block per test (passed and failed)", () => {
    const comment = renderComment(groupedReport);
    expect(comment).toContain("## E2E acceptance evidence (overflow)");
    expect(comment).toContain("### Test details");
    const detailsCount = (comment.match(/<details>/g) ?? []).length;
    expect(detailsCount).toBe(3);
  });

  it("returns empty string for an empty report", () => {
    expect(renderComment(emptyReport)).toBe("");
  });

  it("renders a comment even for an all-passed report (every test gets details)", () => {
    const comment = renderComment(allPassedWithDesc);
    expect(comment).toContain("## E2E acceptance evidence (overflow)");
    const detailsCount = (comment.match(/<details>/g) ?? []).length;
    expect(detailsCount).toBe(2);
  });
});

describe("collapsing repeated runs of one test case", () => {
  it("emits one details block per test case, not one per run", () => {
    const body = renderBody(flatRerunReport, { inlineDetails: true });
    const detailsCount = (body.match(/<details>/g) ?? []).length;
    expect(detailsCount).toBe(3);
    expect(body).toContain("**Runs:** 2 — showing the latest");
  });

  it("numbers the collapsed entries consecutively in a flat list", () => {
    const md = renderOverview(flatRerunReport);
    expect(ordinalsFrom(md, OVERVIEW_ORDINAL)).toEqual([1, 2, 3]);
  });

  it("numbers the collapsed entries consecutively inside a use-case group", () => {
    const md = renderOverview(groupedRerunReport);
    expect(ordinalsFrom(md, OVERVIEW_ORDINAL)).toEqual([1, 2, 3]);
  });

  it("gives the summary the same ordinals as the details blocks", () => {
    const [overview, details] = renderBody(flatRerunReport, { inlineDetails: true }).split("\n---\n");
    expect(ordinalsFrom(details, DETAILS_ORDINAL)).toEqual([1, 2, 3]);
    expect(ordinalsFrom(overview, OVERVIEW_ORDINAL)).toEqual(ordinalsFrom(details, DETAILS_ORDINAL));
  });

  it("shows the rerun's outcome, not the original attempt's", () => {
    const body = renderBody(flatRerunReport, { inlineDetails: true });
    expect(body).toContain("Checkout completes with a saved card (rerun)");
    expect(body).not.toContain("Timed out waiting for the confirmation banner");
  });
});
