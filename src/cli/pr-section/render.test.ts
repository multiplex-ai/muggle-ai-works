import { describe, it, expect } from "vitest";

import {
  DASHBOARD_URL_BASE,
  renderSummary,
  renderRow,
  renderFailureDetails,
  renderBody,
  renderComment,
} from "./render.js";
import type { E2eReport, FailedTest, PassedTest } from "./types.js";

const passed: PassedTest = {
  name: "Login flow",
  testCaseId: "tc-1",
  runId: "run-1",
  viewUrl: "https://www.muggle-ai.com/x/run-1",
  status: "passed",
  steps: [
    { stepIndex: 0, action: "Navigate to /login", screenshotUrl: "https://cdn/1-0.png" },
    { stepIndex: 1, action: "Click Sign In", screenshotUrl: "https://cdn/1-1.png" },
  ],
};

const failed: FailedTest = {
  name: "Checkout flow",
  testCaseId: "tc-2",
  runId: "run-2",
  viewUrl: "https://www.muggle-ai.com/x/run-2",
  status: "failed",
  failureStepIndex: 1,
  error: "Element not found",
  steps: [
    { stepIndex: 0, action: "Add item", screenshotUrl: "https://cdn/2-0.png" },
    { stepIndex: 1, action: "Click confirm", screenshotUrl: "https://cdn/2-1.png" },
  ],
};

const allPassed: E2eReport = { projectId: "p1", tests: [passed] };
const withFailure: E2eReport = { projectId: "p1", tests: [passed, failed] };

describe("renderSummary", () => {
  it("includes count, one-liner, hero, and dashboard link for all-passed", () => {
    const md = renderSummary(allPassed);
    expect(md).toContain("**1 passed / 0 failed**");
    expect(md).toContain("All 1 acceptance tests passed.");
    expect(md).toContain("https://cdn/1-1.png"); // hero = last step of first passed
    expect(md).toContain(`${DASHBOARD_URL_BASE}/p1/scripts`);
  });

  it("shows failure hero when there are failures", () => {
    const md = renderSummary(withFailure);
    expect(md).toContain("**1 passed / 1 failed**");
    expect(md).toContain('"Checkout flow" broke at step 1: Element not found.');
    expect(md).toContain("https://cdn/2-1.png"); // hero = failure step
  });

  it("omits the hero block when there are zero tests", () => {
    const md = renderSummary({ projectId: "p1", tests: [] });
    expect(md).toContain("No acceptance tests were executed.");
    expect(md).not.toContain("<img");
  });
});

describe("renderRow", () => {
  it("renders a passed row with the final-step thumbnail", () => {
    const row = renderRow(passed);
    expect(row).toContain("[Login flow](https://www.muggle-ai.com/x/run-1)");
    expect(row).toContain("✅");
    expect(row).toContain("https://cdn/1-1.png");
  });

  it("renders a failed row with the failure-step thumbnail and inline error", () => {
    const row = renderRow(failed);
    expect(row).toContain("[Checkout flow](https://www.muggle-ai.com/x/run-2)");
    expect(row).toContain("❌");
    expect(row).toContain("https://cdn/2-1.png");
    expect(row).toContain("Element not found");
  });
});

describe("renderFailureDetails", () => {
  it("renders a <details> block with every step and marks the failure step", () => {
    const md = renderFailureDetails(failed);
    expect(md).toContain("<details>");
    expect(md).toContain("Checkout flow");
    expect(md).toContain("Add item");
    expect(md).toContain("Click confirm");
    expect(md).toContain("⚠️");
    expect(md).toContain("Element not found");
    expect(md).toContain("https://cdn/2-0.png");
    expect(md).toContain("https://cdn/2-1.png");
  });
});

describe("renderBody", () => {
  it("renders body with inline failure details when inlineFailureDetails=true", () => {
    const body = renderBody(withFailure, { inlineFailureDetails: true });
    expect(body).toContain("## E2E Acceptance Results");
    expect(body).toContain("| Test Case |");
    expect(body).toContain("<details>");
    expect(body).not.toContain("Full step-by-step evidence in the comment");
  });

  it("renders body with pointer line when inlineFailureDetails=false", () => {
    const body = renderBody(withFailure, { inlineFailureDetails: false });
    expect(body).toContain("## E2E Acceptance Results");
    expect(body).toContain("| Test Case |");
    expect(body).not.toContain("<details>");
    expect(body).toContain("Full step-by-step evidence in the comment below");
  });

  it("all-passed body has no failure details and no pointer line in either mode", () => {
    const inline = renderBody(allPassed, { inlineFailureDetails: true });
    const spilled = renderBody(allPassed, { inlineFailureDetails: false });
    expect(inline).not.toContain("<details>");
    expect(spilled).not.toContain("<details>");
    expect(spilled).not.toContain("Full step-by-step evidence");
  });
});

describe("renderComment", () => {
  it("renders a comment with one <details> block per failed test", () => {
    const comment = renderComment(withFailure);
    expect(comment).toContain("## E2E acceptance evidence (overflow)");
    expect(comment).toContain("<details>");
    expect(comment).toContain("Checkout flow");
  });

  it("returns empty string when there are no failures", () => {
    expect(renderComment(allPassed)).toBe("");
  });
});
