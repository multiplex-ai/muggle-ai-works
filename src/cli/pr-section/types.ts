/**
 * Zod schema and TypeScript types for the e2e-acceptance report that
 * muggle-do's e2e-acceptance agent produces and build-pr-section consumes.
 */

import { z } from "zod";

const StepSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  action: z.string().min(1),
  screenshotUrl: z.string().url(),
});

const PassedTestSchema = z.object({
  name: z.string().min(1),
  testCaseId: z.string().min(1),
  testScriptId: z.string().min(1).optional(),
  runId: z.string().min(1),
  viewUrl: z.string().url(),
  status: z.literal("passed"),
  steps: z.array(StepSchema),
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
});

const TestResultSchema = z.discriminatedUnion("status", [
  PassedTestSchema,
  FailedTestSchema,
]);

export const E2eReportSchema = z.object({
  projectId: z.string().min(1),
  tests: z.array(TestResultSchema),
});

export type E2eReport = z.infer<typeof E2eReportSchema>;
export type TestResult = z.infer<typeof TestResultSchema>;
export type PassedTest = z.infer<typeof PassedTestSchema>;
export type FailedTest = z.infer<typeof FailedTestSchema>;
export type Step = z.infer<typeof StepSchema>;
