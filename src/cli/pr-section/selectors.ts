/**
 * Deterministic selectors that derive summary-block inputs from an e2e report.
 * Pure: no markdown, no I/O, no randomness.
 */

import type { E2eReport, FailedTest, PassedTest } from "./types.js";

/**
 * Hero screenshot used at the top of the evidence block.
 */
export interface IHero {
  /** Cloud URL of the hero screenshot. */
  screenshotUrl: string;
  /** Name of the test the screenshot came from (for alt text + caption). */
  testName: string;
  /** Why this screenshot was chosen. */
  kind: "failure" | "final";
}

/** Max characters in the executive one-liner (keeps PR previews single-line). */
const ONE_LINER_BUDGET = 160;

/**
 * Pick the hero screenshot for the evidence block.
 *
 * Rule:
 *  1. If any test failed → first failed test's failure-step screenshot.
 *  2. Else if any test passed with at least one step → first passed test's last step.
 *  3. Else → null.
 */
export function selectHero (report: E2eReport): IHero | null {
  const firstFailed = report.tests.find(
    (t): t is FailedTest => t.status === "failed",
  );
  if (firstFailed) {
    const step = firstFailed.steps.find((s) => s.stepIndex === firstFailed.failureStepIndex);
    if (step) {
      return {
        screenshotUrl: step.screenshotUrl,
        testName: firstFailed.name,
        kind: "failure",
      };
    }
  }
  const firstPassedWithSteps = report.tests.find(
    (t): t is PassedTest => t.status === "passed" && t.steps.length > 0,
  );
  if (firstPassedWithSteps) {
    const lastStep = firstPassedWithSteps.steps[firstPassedWithSteps.steps.length - 1];
    return {
      screenshotUrl: lastStep.screenshotUrl,
      testName: firstPassedWithSteps.name,
      kind: "final",
    };
  }
  return null;
}

/**
 * Build the single-sentence verdict that heads the evidence block.
 *
 * Examples:
 *  - "All 4 acceptance tests passed."
 *  - "1 of 4 failed — \"Checkout flow\" broke at step 3: Element not found."
 *  - "No acceptance tests were executed."
 */
export function buildOneLiner (report: E2eReport): string {
  const total = report.tests.length;
  if (total === 0) {
    return "No acceptance tests were executed.";
  }
  const failed = report.tests.filter((t): t is FailedTest => t.status === "failed");
  if (failed.length === 0) {
    return `All ${total} acceptance tests passed.`;
  }
  const first = failed[0];
  const prefix = `${failed.length} of ${total} failed — "${first.name}" broke at step ${first.failureStepIndex}: `;
  const available = ONE_LINER_BUDGET - prefix.length - 1; // -1 for trailing period
  const error = first.error.length > available
    ? first.error.slice(0, Math.max(0, available - 1)) + "…"
    : first.error;
  return `${prefix}${error}.`;
}
