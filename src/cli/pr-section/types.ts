/**
 * Zod schema and TypeScript types for the e2e-acceptance report that
 * muggle-do's e2e-acceptance agent produces and build-pr-section consumes.
 */

import { z } from "zod";

// `action` is the operation verb (navigate, click, halt). `description` is the
// agent's readable account of the step — the action script's briefExplanation —
// and is what a reader can follow; optional so reports assembled before it
// existed still parse. `screenshotUrl` is the page before the step acts;
// `afterScreenshotUrl` the page after it, which the action script never stores:
// it is the next visual step's screenshot, or the summary step's for the last.
const StepSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  action: z.string().min(1),
  description: z.string().min(1).optional(),
  screenshotUrl: z.string().url(),
  afterScreenshotUrl: z.string().url().optional(),
});

const PassedTestSchema = z.object({
  name: z.string().min(1),
  testCaseId: z.string().min(1),
  testScriptId: z.string().min(1).optional(),
  runId: z.string().min(1),
  viewUrl: z.string().url(),
  status: z.literal("passed"),
  steps: z.array(StepSchema),
  useCaseName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  endingScreenshotUrl: z.string().url().optional(),
  endingScreenshotCaption: z.string().min(1).optional(),
});

const FailedTestSchema = z.object({
  name: z.string().min(1),
  testCaseId: z.string().min(1),
  testScriptId: z.string().min(1).optional(),
  runId: z.string().min(1),
  viewUrl: z.string().url(),
  status: z.literal("failed"),
  steps: z.array(StepSchema),
  failureStepIndex: z.number().int().nonnegative(),
  error: z.string().min(1),
  artifactsDir: z.string().min(1).optional(),
  useCaseName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  endingScreenshotUrl: z.string().url().optional(),
  endingScreenshotCaption: z.string().min(1).optional(),
});

// A test whose outcome cannot be classified as pass/fail: the test couldn't
// run cleanly (no replayable script existed, environment precondition was
// unmet, infra error blocked execution, etc.). The product is not implicated.
// Carries the same run identifiers as passed/failed so the dashboard link
// still works; `reason` explains why the result is inconclusive instead of
// pass/fail. `steps[]` may be empty when the run never produced action steps.
const InconclusiveTestSchema = z.object({
  name: z.string().min(1),
  testCaseId: z.string().min(1),
  testScriptId: z.string().min(1).optional(),
  runId: z.string().min(1),
  viewUrl: z.string().url(),
  status: z.literal("inconclusive"),
  steps: z.array(StepSchema),
  reason: z.string().min(1),
  artifactsDir: z.string().min(1).optional(),
  useCaseName: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  endingScreenshotUrl: z.string().url().optional(),
  endingScreenshotCaption: z.string().min(1).optional(),
});

const TestResultSchema = z.discriminatedUnion("status", [
  PassedTestSchema,
  FailedTestSchema,
  InconclusiveTestSchema,
]);

export const E2eReportSchema = z.object({
  projectId: z.string().min(1),
  tests: z.array(TestResultSchema),
});

export type E2eReport = z.infer<typeof E2eReportSchema>;
export type TestResult = z.infer<typeof TestResultSchema>;
export type PassedTest = z.infer<typeof PassedTestSchema>;
export type FailedTest = z.infer<typeof FailedTestSchema>;
export type InconclusiveTest = z.infer<typeof InconclusiveTestSchema>;
export type Step = z.infer<typeof StepSchema>;

/**
 * How much of each step's screenshots a test's details carry. The overflow comment steps down this ladder when a
 * richer rendering would exceed GitHub's comment size cap.
 */
export enum StepScreenshotDetailEnum {
  /** Before and after, side by side. */
  BeforeAndAfter = "before-and-after",
  /** The page before each step only. */
  BeforeOnly = "before-only",
  /** Step text only; the ending screen still shows. */
  None = "none",
}
