import { describe, it, expect } from "vitest";

import {
  DASHBOARD_URL_BASE,
  renderOverview,
  renderTestDetails,
  renderBody,
  renderComment,
} from "../../../cli/pr-section/render.js";
import type { E2eReport, FailedTest, PassedTest } from "../../../cli/pr-section/types.js";

const PROJECT_ID = "p1";

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

const groupedReport: E2eReport = {
  projectId: PROJECT_ID,
  tests: [passedWithDesc, failedWithDesc, passedAuthGroup],
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

describe("renderOverview", () => {
  it("renders counts and a flat numbered list when no test has a useCaseName", () => {
    const md = renderOverview(flatReport);
    expect(md).toContain("## E2E Acceptance Results");
    expect(md).toContain("**2 tests ran — 1 passed / 1 failed**");
    expect(md).toContain("**Tests run:**");
    expect(md).toContain("- **1.** ✅ Logout flow");
    expect(md).toContain("- **2.** ❌ Checkout breaks");
    // No nested use-case bullets (but the numbering does start the bullet with **).
    // So the "no group bullets" check is by the em-style: "- **Word**" with no digit.
    expect(md).not.toMatch(/^- \*\*[A-Za-z]/m);
  });

  it("groups tests by useCaseName with global numbering across groups", () => {
    const md = renderOverview(groupedReport);
    expect(md).toContain("**3 tests ran — 2 passed / 1 failed**");
    expect(md).toContain("- **Create a New Project**");
    expect(md).toContain("  - **1.** ✅ User creates a new project with valid URL");
    expect(md).toContain("  - **2.** ❌ User receives error for invalid URL format");
    expect(md).toContain("- **User Authentication**");
    expect(md).toContain("  - **3.** ✅ Login with valid credentials");
  });

  it("handles an empty report with a friendly placeholder", () => {
    const md = renderOverview(emptyReport);
    expect(md).toContain("## E2E Acceptance Results");
    expect(md).toContain("**0 tests ran — 0 passed / 0 failed**");
    expect(md).toContain("_No tests were executed._");
    expect(md).not.toContain("**Tests run:**");
  });
});

describe("renderTestDetails", () => {
  it("renders a passed test with description and numbered summary line", () => {
    const md = renderTestDetails(passedWithDesc, PROJECT_ID, 1);
    expect(md).toContain("<details>");
    expect(md).toContain("<summary>");
    expect(md).toContain("<b>1. User creates a new project with valid URL</b> ✅");
    expect(md).toContain("— Verify that a logged-in user can create a new project");
    expect(md).toContain("<i>▶ click to expand</i>");
    // Ending screenshot = last step, with a caption above it.
    expect(md).toContain("**📸 Ending screen — Final page after the test completed**");
    expect(md).toContain('<img src="https://cdn/1-2.png" width="720"');
    expect(md).toContain("**Result:** ✅ PASSED");
    expect(md).toContain("**Steps:** 3");
    expect(md).toContain(`${DASHBOARD_URL_BASE}/p1/scripts?modal=script-details&testCaseId=tc-1`);
    expect(md).toContain("</details>");
  });

  it("renders a passed test without description (no em-dash, no description text)", () => {
    const md = renderTestDetails(passedNoMeta, PROJECT_ID, 4);
    expect(md).toContain("<b>4. Logout flow</b> ✅ <i>▶ click to expand</i>");
    // No " — " separator between name and the tail.
    expect(md).not.toMatch(/<b>4\. Logout flow<\/b> ✅ —/);
  });

  it("renders a failed test with error, numbered summary, and failure-step screenshot", () => {
    const md = renderTestDetails(failedWithDesc, PROJECT_ID, 2);
    expect(md).toContain("<b>2. User receives error for invalid URL format</b> ❌");
    expect(md).toContain("**Result:** ❌ FAILED at step 3");
    expect(md).toContain("**Error:** `Element not found: submit button`");
    expect(md).toContain("**Steps:** 4");
    // Ending screenshot = failure step (stepIndex 3). Caption reflects failure.
    expect(md).toContain("**📸 Ending screen — Failure at step 3**");
    expect(md).toContain('<img src="https://cdn/2-3.png"');
  });

  it("uses endingScreenshotUrl + endingScreenshotCaption when provided on the test", () => {
    const overrideTest: PassedTest = {
      ...passedWithDesc,
      endingScreenshotUrl: "https://cdn/summary.png",
      endingScreenshotCaption: "Success. The goal is achieved.",
    };
    const md = renderTestDetails(overrideTest, PROJECT_ID, 1);
    // Caption shows the caller-provided summary text, not the default.
    expect(md).toContain("**📸 Ending screen — Success. The goal is achieved.**");
    // Image uses the override URL, NOT the last step in steps[].
    expect(md).toContain('<img src="https://cdn/summary.png"');
    expect(md).not.toContain('<img src="https://cdn/1-2.png"');
  });

  it("escapes backticks in the error message so inline code stays balanced", () => {
    const md = renderTestDetails(failedNoMeta, PROJECT_ID, 5);
    expect(md).toContain("**Error:**");
    // Raw backticks from the error must not appear unescaped in the rendered output.
    expect(md).not.toMatch(/Timeout waiting for `button/);
    // The two backticks wrapping `button[...]` should be replaced with U+2018.
    expect(md).toContain("Timeout waiting for \u2018button[data-id='confirm']\u2018");
    // The `**Error:** `...` ` inline-code wrapper must still be a clean pair.
    const errorLine = md.split("\n").find((l) => l.startsWith("**Error:**"))!;
    expect(errorLine).toMatch(/^\*\*Error:\*\* `[^`]+`$/);
  });
});

describe("renderBody", () => {
  it("renders overview + details inline for a grouped mixed pass/fail report", () => {
    const body = renderBody(groupedReport, { inlineDetails: true });
    expect(body).toContain("## E2E Acceptance Results");
    expect(body).toContain("- **Create a New Project**");
    expect(body).toContain("---");
    // Three <details> blocks — one per test.
    const detailsCount = (body.match(/<details>/g) ?? []).length;
    expect(detailsCount).toBe(3);
  });

  it("renders overview + pointer line when inlineDetails=false", () => {
    const body = renderBody(groupedReport, { inlineDetails: false });
    expect(body).toContain("## E2E Acceptance Results");
    expect(body).toContain("---");
    expect(body).toContain("_Full per-test details in the comment below");
    expect(body).not.toContain("<details>");
  });

  it("renders every passed test as a details block (not just failures)", () => {
    const body = renderBody(allPassedWithDesc, { inlineDetails: true });
    const detailsCount = (body.match(/<details>/g) ?? []).length;
    expect(detailsCount).toBe(2);
  });

  it("renders a flat numbered list when no test has a useCaseName", () => {
    const body = renderBody(allPassedNoMeta, { inlineDetails: true });
    expect(body).toContain("- **1.** ✅ Logout flow");
    // No use-case group bullets (letter-prefixed, not digit-prefixed).
    expect(body).not.toMatch(/^- \*\*[A-Za-z]/m);
  });

  it("empty report: no details, no horizontal rule", () => {
    const body = renderBody(emptyReport, { inlineDetails: true });
    expect(body).toContain("**0 tests ran — 0 passed / 0 failed**");
    expect(body).toContain("_No tests were executed._");
    expect(body).not.toContain("---");
    expect(body).not.toContain("<details>");
  });
});

describe("renderComment", () => {
  it("renders a comment with one <details> block per test (passed and failed)", () => {
    const comment = renderComment(groupedReport);
    expect(comment).toContain("## E2E acceptance evidence (overflow)");
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
