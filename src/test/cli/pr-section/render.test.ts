import { describe, it, expect } from "vitest";

import { DASHBOARD_URL_BASE, TEST_DETAILS_ANCHOR_PREFIX } from "../../../cli/pr-section/constants.js";
import { parseE2eResultMarker } from "../../../e2e-result/marker.js";
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
const TEST_HEADING = /^#### /gm;

/** Count the per-test blocks by their heading; steps are <details> too, so they cannot be counted by that tag. */
function testBlocks (markdown: string): number {
  return (markdown.match(TEST_HEADING) ?? []).length;
}

/** The ordinals in the per-test headings, in document order. */
function detailsOrdinals (markdown: string): number[] {
  return [...markdown.matchAll(/^#### \S+ (\d+)\. /gm)].map((m) => Number(m[1]));
}

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
    expect(md).toContain("<summary><b>Create a New Project</b>");
    expect(md).toContain("- ✅ **1.** User creates a new project with valid URL");
    expect(md).toContain("- ❌ **2.** User receives error for invalid URL format");
    expect(md).toContain("<summary><b>User Authentication</b>");
    expect(md).toContain("- ✅ **3.** Login with valid credentials");
  });

  // A failure must never sit behind a click, while an all-passed use case can fold away.
  it("opens a use case that has a failure and folds one that all passed, each labelled with its tally", () => {
    const md = renderOverview(groupedReport);
    expect(md).toContain("<details open><summary><b>Create a New Project</b> — ✅ 1 passed · ❌ 1 failed</summary>");
    expect(md).toContain("<details><summary><b>User Authentication</b> — ✅ 1 passed</summary>");
  });

  it("links every summary line to its test's details", () => {
    const md = renderOverview(groupedReport);
    expect(md).toContain("- ✅ **1.** User creates a new project with valid URL · [see details](#muggle-test-tc-1)");
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

// Steps as a real action script yields them after assembly: the operation verb
// in `action`, the agent's readable explanation in `description`. The previous
// layout was written against fixtures whose `action` held readable text, which
// real reports never do — so these are taken from a recorded run.
const realSteps: Step[] = [
  { stepIndex: 0, action: "navigate", description: "Workflow started at url [http://localhost:3011/muggleTestV0/landing].", screenshotUrl: "https://cdn/real-0.png" },
  { stepIndex: 1, action: "click", description: "Click 'Accept all' button to dismiss the cookie consent dialog.", screenshotUrl: "https://cdn/real-1.png" },
  { stepIndex: 2, action: "click", description: "Click the 'How it works' link with element id [1] to navigate to the section.", screenshotUrl: "https://cdn/real-2.png" },
  { stepIndex: 3, action: "halt", description: "Verify that all header links navigate to existing sections.", screenshotUrl: "https://cdn/real-3.png" },
];

const passedRealSteps: PassedTest = {
  ...passedNoMeta,
  name: "Every header link scrolls to a section that exists",
  testCaseId: "tc-real",
  steps: realSteps,
};

describe("renderTestDetails", () => {
  it("titles the test with a heading that opens on the status glyph", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md.split("\n").find((line) => line.startsWith("#### "))).toBe("#### ✅ 1. User creates a new project with valid URL");
    expect(md).not.toContain("click to expand");
  });

  // GitHub lays a heading inside <summary> out inline-block, so a title longer
  // than one line drops below its disclosure triangle and strands it.
  it("keeps the title out of any collapsible", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).not.toMatch(/<summary><h\d/);
  });

  it("states the test's description under the heading, not in it", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md.split("\n")[0]).not.toContain("Verify that a logged-in user");
    expect(md).toContain("_Verify that a logged-in user can create a new project");
  });

  // The verdict reads without expanding anything; only the evidence collapses.
  it("shows the result table outside the collapsible and tucks steps and screens inside one", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    const collapsible = md.indexOf("<details><summary><kbd>Show ");
    expect(collapsible).toBeGreaterThan(md.indexOf("| **Result** |"));
    expect(md.indexOf("<summary>📷 1 · ")).toBeGreaterThan(collapsible);
    expect(md.indexOf("**Ending screen**")).toBeGreaterThan(collapsible);
    expect(md.trimEnd().endsWith("</details>")).toBe(true);
  });

  // A quote in the alt text closes the attribute early, and GitHub prints the
  // whole tag as text in place of the screenshot.
  it("escapes a quote in the test name where it becomes the image's alt text", () => {
    const md = renderTestDetails(latest({ ...passedWithDesc, name: 'Find the "What else" control' }), PROJECT_ID, 1);
    expect(md).toContain('alt="Find the &quot;What else&quot; control"');
  });

  it("anchors the details where the summary's link lands", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md.split("\n")[0]).toBe(`<a name="muggle-test-${passedWithDesc.testCaseId}"></a>`);
  });

  it("indents what each collapsible reveals under its toggle", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).toMatch(/<details><summary><kbd>Show [^<]+<\/kbd><\/summary>\n<dl><dd>\n/);
    expect(md).toMatch(/<summary>📷 1 · [^\n]+<\/summary>\n<dl><dd>\n/);
    expect(md.trimEnd().endsWith("</dd></dl>\n</details>")).toBe(true);
  });

  it("shows a step's before and after side by side when the report has both", () => {
    const md = renderTestDetails(
      latest({
        ...passedWithDesc,
        steps: [{ stepIndex: 0, action: "click", screenshotUrl: "https://cdn/before.png", afterScreenshotUrl: "https://cdn/after.png" }],
      }),
      PROJECT_ID,
      1,
    );
    expect(md).toContain("| Before | After |");
    expect(md).toContain('?url=https%3A%2F%2Fcdn%2Fbefore.png&amp;w=');
    expect(md).toContain('?url=https%3A%2F%2Fcdn%2Fafter.png&amp;w=');
    expect(md).toContain('alt="Step 1 after"');
  });

  // GitHub loads every image on the page, even in closed collapsibles, so each screenshot is served resized.
  it("serves screenshots as resized thumbnails linking to the original", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).toMatch(/<img src="https:\/\/images\.weserv\.nl\/\?url=[^"]+&amp;w=840&amp;q=70&amp;output=jpg"/);
    const proxied = "https://images.weserv.nl/?url=https%3A%2F%2Fstorage%2Fshot.jpg";
    const onProxy = renderTestDetails(
      latest({ ...passedWithDesc, steps: [{ stepIndex: 0, action: "click", screenshotUrl: proxied }] }),
      PROJECT_ID,
      1,
    );
    expect(onProxy).toContain(`<img src="${proxied}&amp;w=840`);
  });

  it("drops the description when it only repeats the test name", () => {
    const md = renderTestDetails(
      latest({ ...passedWithDesc, name: "The page closes by asking for the one action", description: "The page closes by asking for the one action." }),
      PROJECT_ID,
      1,
    );
    expect(md).not.toContain("_The page closes");
  });

  // GitHub's disclosure triangle is small and only a hover says it opens, so the toggle is drawn as a key cap
  // that says what it reveals, and each step row leads with a camera.
  it("labels the evidence toggle as a button saying what it reveals", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).toMatch(/<details><summary><kbd>Show \d+ steps? and screenshots<\/kbd><\/summary>/);
    expect(md).toMatch(/<summary>📷 1 · /);
  });

  it("labels a step-less test's toggle by the ending screen it reveals", () => {
    const md = renderTestDetails(
      latest({ ...passedWithDesc, steps: [], endingScreenshotUrl: "https://cdn/end.png" }),
      PROJECT_ID,
      1,
    );
    expect(md).toContain("<summary><kbd>Show the ending screen</kbd></summary>");
  });

  it("lays the result out as a labelled table", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).toContain("| **Result** | ✅ Passed |\n|:--|:--|");
    expect(md).not.toContain("| | |");
    expect(md).toContain("| **Result** | ✅ Passed |");
    expect(md).not.toContain("| **Why** |");
  });

  it("gives a failure its step ordinal and its error as plain text", () => {
    const md = renderTestDetails(latest(failedWithDesc), PROJECT_ID, 2);
    expect(md.split("\n").find((line) => line.startsWith("#### "))).toBe("#### ❌ 2. User receives error for invalid URL format");
    expect(md).toContain("| **Result** | ❌ Failed at step 4 |");
    expect(md).toContain("| **Why** | Element not found: submit button |");
  });

  it("gives an inconclusive run its reason", () => {
    const md = renderTestDetails(latest(inconclusiveWithDesc), PROJECT_ID, 3);
    expect(md).toContain("| **Result** | ⚠️ Inconclusive |");
    expect(md).toContain("| **Why** | No replayable script exists yet — needs first generation run. |");
  });

  it("keeps a pipe or line break in the reason from breaking the table row", () => {
    const md = renderTestDetails(
      latest({ ...inconclusiveWithDesc, reason: "a | b\nsecond line" }),
      PROJECT_ID,
      1,
    );
    expect(md).toContain("| **Why** | a \\| b second line |");
  });

  it("names the run's step count and where the link goes", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    const runRow = md.split("\n").find((l) => l.startsWith("| **Run** |"))!;
    expect(runRow).toContain("3 browser steps ·");
    expect(runRow).toContain("Open the full run on Muggle AI →");
    expect(runRow).toContain(
      "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/p1/scripts?modal=script-details&testCaseId=tc-1",
    );
  });

  it("marks how many runs a collapsed test case had, and which one is shown", () => {
    const md = renderTestDetails(latest(rerunSecondAttempt, 2), PROJECT_ID, 2);
    expect(md).toContain("| **Attempts** | 2 — showing the latest |");
  });

  it("omits the attempts row for a test case that ran once", () => {
    expect(renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1)).not.toContain("**Attempts**");
  });

  it("links into the ring the run happened on when a base is supplied", () => {
    const md = renderTestDetails(
      latest(passedWithDesc),
      PROJECT_ID,
      1,
      "https://staging.muggle-ai.com/muggleTestV0/dashboard/projects",
    );
    expect(md).toContain("https://staging.muggle-ai.com/muggleTestV0/dashboard/projects/p1/scripts");
    expect(md).not.toContain("https://www.muggle-ai.com");
  });

  it("falls back to production when no base is supplied", () => {
    expect(renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1)).toContain(DASHBOARD_URL_BASE);
  });

  it("opens the dashboard link in a new tab", () => {
    const md = renderTestDetails(latest(passedWithDesc), PROJECT_ID, 1);
    expect(md).toContain('target="_blank"');
    expect(md).toContain('rel="noopener noreferrer"');
  });
});

describe("step collapsibles", () => {
  it("labels each step with the agent's explanation, not the operation verb", () => {
    const md = renderTestDetails(latest(passedRealSteps), PROJECT_ID, 1);
    expect(md).toContain("<summary>📷 2 · Click 'Accept all' button to dismiss the cookie consent dialog.</summary>");
    expect(md).not.toMatch(/<summary>📷 \d+ · click<\/summary>/);
  });

  it("drops the internal element id the agent's explanation carries", () => {
    const md = renderTestDetails(latest(passedRealSteps), PROJECT_ID, 1);
    expect(md).toContain("<summary>📷 3 · Click the 'How it works' link to navigate to the section.</summary>");
    expect(md).not.toContain("element id [");
  });

  // Recorded runs also write it as `#N`, which GitHub would autolink as an issue.
  it("drops the #-numbered form of the element id too", () => {
    const md = renderTestDetails(
      latest({ ...passedNoMeta, steps: [{ stepIndex: 0, action: "input", description: "Input email in the 'Email address' field with element id #0.", screenshotUrl: "https://cdn/x.png" }] }),
      PROJECT_ID,
      1,
    );
    expect(md).toContain("<summary>📷 1 · Input email in the 'Email address' field.</summary>");
    expect(md).not.toContain("#0");
  });

  it("falls back to the operation verb for a step with no explanation", () => {
    const md = renderTestDetails(latest(passedNoMeta), PROJECT_ID, 1);
    expect(md).toContain("<summary>📷 1 · Click user menu</summary>");
  });

  it("opens each step onto its own screenshot", () => {
    const md = renderTestDetails(latest(passedRealSteps), PROJECT_ID, 1);
    const step = md.slice(md.indexOf("<summary>📷 2 · "), md.indexOf("<summary>📷 3 · "));
    expect(step).toContain('<img src="https://images.weserv.nl/?url=https%3A%2F%2Fcdn%2Freal-1.png&amp;w=');
    expect(step).not.toContain("https://cdn/real-2.png");
  });

  it("escapes markup in an explanation so it cannot break the collapsible", () => {
    const md = renderTestDetails(
      latest({ ...passedNoMeta, steps: [{ stepIndex: 0, action: "click", description: "Click the <Submit> button", screenshotUrl: "https://cdn/x.png" }] }),
      PROJECT_ID,
      1,
    );
    expect(md).toContain("<summary>📷 1 · Click the &lt;Submit&gt; button</summary>");
  });

  it("closes the block with the ending screenshot, after every step", () => {
    const md = renderTestDetails(latest(passedRealSteps), PROJECT_ID, 1);
    expect(md).toContain("**Ending screen** — Final page after the test completed");
    expect(md.lastIndexOf("<summary>📷 4 · ")).toBeLessThan(md.indexOf("**Ending screen**"));
  });

  it("uses endingScreenshotUrl + endingScreenshotCaption when provided on the test", () => {
    const md = renderTestDetails(
      latest({ ...passedWithDesc, endingScreenshotUrl: "https://cdn/summary.png", endingScreenshotCaption: "Success. The goal is achieved." }),
      PROJECT_ID,
      1,
    );
    expect(md).toContain("**Ending screen** — Success. The goal is achieved.");
    expect(md).toContain('<img src="https://cdn/summary.png" width="720"');
  });

  it("captions an inconclusive run's last frame as cut short", () => {
    const md = renderTestDetails(latest(inconclusiveWithSteps), PROJECT_ID, 4);
    expect(md).toContain("**Ending screen** — Last frame before run was cut short");
    expect(md).toContain('<img src="https://cdn/7-1.png" width="720"');
  });

  it("renders neither steps nor an ending screen for a run with no steps", () => {
    const md = renderTestDetails(latest(inconclusiveWithDesc), PROJECT_ID, 3);
    expect(md).not.toContain("**Steps**");
    expect(md).not.toContain("**Ending screen**");
    expect(md).not.toContain("<kbd>Show");
    expect(md).toContain("| **Run** | 0 browser steps ·");
  });
});

describe("step list elision", () => {
  const withSteps = (count: number): ILatestRun => latest({ ...passedNoMeta, steps: buildSteps(count) });

  it("shows every step of a 20-step run", () => {
    const md = renderTestDetails(withSteps(20), PROJECT_ID, 1);
    expect(md).toContain("<summary>📷 20 · Action 20</summary>");
    expect(md).not.toContain("more step");
  });

  it("elides one step past the limit, keeping 12 head and 8 tail steps", () => {
    const md = renderTestDetails(withSteps(21), PROJECT_ID, 1);
    expect(md).toContain("<summary>📷 12 · Action 12</summary>");
    expect(md).not.toContain("<summary>📷 13 · ");
    expect(md).toContain("1 more step");
    expect(md).toContain("<summary>📷 14 · Action 14</summary>");
    expect(md).toContain("<summary>📷 21 · Action 21</summary>");
  });

  it("keeps a long run's tail numbered by true position and points to the full run", () => {
    const md = renderTestDetails(withSteps(50), PROJECT_ID, 1);
    expect(md).toContain("<summary>📷 1 · Action 1</summary>");
    expect(md).toContain("30 more steps");
    expect(md).toContain("<summary>📷 43 · Action 43</summary>");
    expect(md).toContain("<summary>📷 50 · Action 50</summary>");
    const elision = md.split("\n").find((l) => l.includes("30 more steps"))!;
    expect(elision).toContain("Open the full run on Muggle AI →");
  });
});

describe("test details dividers", () => {
  it("rules a line between consecutive tests, and none after the last", () => {
    const comment = renderComment(groupedReport);
    const details = comment.slice(comment.indexOf("### Test details"));
    expect(details.match(/\n\n---\n\n/g) ?? []).toHaveLength(2);
    expect(details.trimEnd().endsWith("---")).toBe(false);
  });
});

describe("renderBody", () => {
  it("renders summary + details inline under their own headings", () => {
    const body = renderBody(groupedReport, { inlineDetails: true });
    expect(body).toContain("## E2E Acceptance Results");
    expect(body).toContain("### Summary");
    expect(body).toContain("### Test details");
    expect(body).toContain("<summary><b>Create a New Project</b>");
    expect(body).toContain("---");
    const detailsCount = testBlocks(body);
    expect(detailsCount).toBe(3);
  });

  it("renders summary + pointer line when inlineDetails=false", () => {
    const body = renderBody(groupedReport, { inlineDetails: false });
    expect(body).toContain("## E2E Acceptance Results");
    expect(body).toContain("---");
    expect(body).toContain("_Full per-test details in the comment below");
    expect(body).not.toContain("<kbd>Show");
    expect(body).not.toContain("### Test details");
  });

  it("renders every passed test as a details block (not just failures)", () => {
    const body = renderBody(allPassedWithDesc, { inlineDetails: true });
    const detailsCount = testBlocks(body);
    expect(detailsCount).toBe(2);
  });

  it("renders a flat numbered list when no test has a useCaseName", () => {
    const body = renderBody(allPassedNoMeta, { inlineDetails: true });
    expect(body).toContain("- ✅ **1.** Logout flow");
    expect(body).not.toMatch(/^- \*\*[A-Za-z]/m);
  });

  it("carries the result record the CI check reads, inline or spilled", () => {
    for (const inlineDetails of [true, false]) {
      const record = parseE2eResultMarker(renderBody(groupedReport, { inlineDetails: inlineDetails }));
      expect(record?.total).toBe(3);
      expect(record?.passed).toBe(2);
      expect(record?.unpassed.map((c) => c.testCaseId)).toEqual(["tc-2"]);
    }
  });

  it("lists failed and inconclusive cases under the headline, linked to their details", () => {
    const failing = renderBody(groupedReport, { inlineDetails: true });
    expect(failing).toContain("**Needs attention**");
    expect(failing).toContain("- ❌ **User receives error for invalid URL format** — failed at step");
    expect(failing).toContain(`[see details](#${TEST_DETAILS_ANCHOR_PREFIX}tc-2)`);
    const inconclusive = renderBody(mixedWithInconclusiveReport, { inlineDetails: true });
    expect(inconclusive).toContain("- ⚠️ **Clear search input restores full list** — inconclusive:");
  });

  it("omits the attention list when every case passed", () => {
    const body = renderBody(allPassedWithDesc, { inlineDetails: true });
    expect(body).not.toContain("**Needs attention**");
    expect(parseE2eResultMarker(body)?.unpassed).toEqual([]);
  });

  it("empty report: no details, no horizontal rule", () => {
    const body = renderBody(emptyReport, { inlineDetails: true });
    expect(body).toContain("**0 tests ran · 0 passed / 0 failed / 0 inconclusive**");
    expect(body).toContain("_No tests were executed._");
    expect(body).not.toContain("---");
    expect(body).not.toContain("<kbd>Show");
  });
});

describe("renderComment", () => {
  it("renders a comment with one <details> block per test (passed and failed)", () => {
    const comment = renderComment(groupedReport);
    expect(comment).toContain("## E2E acceptance evidence (overflow)");
    expect(comment).toContain("### Test details");
    const detailsCount = testBlocks(comment);
    expect(detailsCount).toBe(3);
  });

  it("returns empty string for an empty report", () => {
    expect(renderComment(emptyReport)).toBe("");
  });

  it("renders a comment even for an all-passed report (every test gets details)", () => {
    const comment = renderComment(allPassedWithDesc);
    expect(comment).toContain("## E2E acceptance evidence (overflow)");
    const detailsCount = testBlocks(comment);
    expect(detailsCount).toBe(2);
  });
});

describe("collapsing repeated runs of one test case", () => {
  it("emits one details block per test case, not one per run", () => {
    const body = renderBody(flatRerunReport, { inlineDetails: true });
    const detailsCount = testBlocks(body);
    expect(detailsCount).toBe(3);
    expect(body).toContain("| **Attempts** | 2 — showing the latest |");
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
    const [overview, details] = renderBody(flatRerunReport, { inlineDetails: true }).split("\n### Test details\n");
    expect(detailsOrdinals(details)).toEqual([1, 2, 3]);
    expect(ordinalsFrom(overview, OVERVIEW_ORDINAL)).toEqual(detailsOrdinals(details));
  });

  it("shows the rerun's outcome, not the original attempt's", () => {
    const body = renderBody(flatRerunReport, { inlineDetails: true });
    expect(body).toContain("Checkout completes with a saved card (rerun)");
    expect(body).not.toContain("Timed out waiting for the confirmation banner");
  });
});
