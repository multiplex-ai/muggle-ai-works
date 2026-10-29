/**
 * Zod schema and TypeScript types for the e2e-acceptance report that
 * muggle-do's e2e-acceptance agent produces and build-pr-section consumes.
 */

import { z } from "zod";

import type { IFailsOnBase } from "../../e2e-result/types.js";

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

// The project short IDs of the test case (TC-42) and of the run (R-2051); optional because entities created
// before short IDs existed carry none.
const TEST_SHORT_ID_FIELDS = {
  testCaseShortId: z.string().min(1).optional(),
  replayShortId: z.string().min(1).optional(),
};

// The runSettings record the run executed under and its window size (`390×844`). One test case run at two
// records is two entries; an entry without `runSettingsId` collapses with the other runs of its test case.
const RUN_SETTINGS_FIELDS = {
  runSettingsId: z.string().min(1).optional(),
  resolutionLabel: z.string().min(1).optional(),
};

const PassedTestSchema = z.object({
  name: z.string().min(1),
  testCaseId: z.string().min(1),
  testScriptId: z.string().min(1).optional(),
  ...TEST_SHORT_ID_FIELDS,
  ...RUN_SETTINGS_FIELDS,
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
  ...TEST_SHORT_ID_FIELDS,
  ...RUN_SETTINGS_FIELDS,
  runId: z.string().min(1),
  viewUrl: z.string().url(),
  status: z.literal("failed"),
  steps: z.array(StepSchema),
  failureStepIndex: z.number().int().nonnegative(),
  error: z.string().min(1),
  // A run of the same test case on the PR's base the author says failed too; build-pr-section verifies it before
  // the walkthrough credits it.
  baselineRunId: z.string().min(1).optional(),
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
  ...TEST_SHORT_ID_FIELDS,
  ...RUN_SETTINGS_FIELDS,
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

export type PassedTest = z.infer<typeof PassedTestSchema>;
/**
 * A failed test. `failsOnBase` is outside the schema, so parsing strips it from any input report: only
 * build-pr-section's baseline verification sets it.
 */
export type FailedTest = z.infer<typeof FailedTestSchema> & { failsOnBase?: IFailsOnBase };
export type InconclusiveTest = z.infer<typeof InconclusiveTestSchema>;
export type TestResult = PassedTest | FailedTest | InconclusiveTest;
export type E2eReport = Omit<z.infer<typeof E2eReportSchema>, "tests"> & { tests: TestResult[] };
export type Step = z.infer<typeof StepSchema>;

/** The fields of a local run result that baseline verification reads. */
export interface IBaselineRunRecord {
  id: string;
  status: string;
  cloudTestCaseId: string;
  cloudRunSettingsId?: string;
  viewUrl?: string;
  localExecutionContext?: { servedStack?: Array<{ headSha: string }> };
}

/** What baseline verification reads the world through; tests inject their own. */
export interface IBaselineVerificationDeps {
  /** Any directory inside the PR's checkout. */
  cwd: string;
  /** Branch the PR merges into; the remote's default branch when omitted. */
  baseBranch?: string;
  /** Trimmed stdout, or null when git exits non-zero. */
  runGit: (args: string[], cwd: string) => Promise<string | null>;
  readRunResult: (runId: string) => IBaselineRunRecord | undefined;
  stderrWrite: (text: string) => boolean;
}

/** The base commits a baseline must have served: from the PR's fork point up to the base tip. */
export interface IBaseRange {
  mergeBaseSha: string;
  baseTipSha: string;
}

/** Whether a cited baseline holds, with what the walkthrough credits or why it refused. */
export type BaselineJudgment =
  | { isCredited: true; failsOnBase: IFailsOnBase }
  | { isCredited: false; refusalReason: string };

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
