/**
 * Zod schemas for local execution tools.
 *
 * These schemas support the minimal local tool set:
 * - Execution (test generation, replay, cancel)
 * - Run results (list, get)
 * - Test scripts (list, get)
 * - Publishing
 *
 * Design principle: Execution tools accept full test case/script details
 * (fetched via muggle-remote-* tools), not just IDs. This keeps local tools free of
 * cloud dependencies.
 */

import { z } from "zod";

/**
 * UUID string schema for Muggle cloud resource IDs and local run-result / test-script record IDs
 * (aligned with e2e `IdSchema` and `randomUUID()` storage filenames).
 */
const MuggleUuidSchema = z.string().uuid();

// ========================================
// Test Case Schema (from muggle-remote-test-case-get)
// ========================================

/**
 * Test case details schema.
 * These fields come from muggle-remote-test-case-get response.
 */
export const TestCaseDetailsSchema = z.object({
  /** Cloud test case ID. */
  id: MuggleUuidSchema.describe("Cloud test case ID (UUID)"),
  /** Test case title. */
  title: z.string().min(1).describe("Test case title"),
  /** Test goal. */
  goal: z.string().min(1).describe("Test goal - what the test should verify"),
  /** Expected result. */
  expectedResult: z.string().min(1).describe("Expected outcome after test execution"),
  /** Preconditions (optional). */
  precondition: z.string().optional().describe("Initial state/setup required before test execution"),
  /** Step-by-step instructions (optional). */
  instructions: z.string().optional().describe("Step-by-step instructions for the test"),
  /** Original cloud URL (for reference, replaced by localUrl). */
  url: z.string().url().optional().describe("Original cloud URL (replaced by localUrl during execution)"),
  /** Cloud project ID (required for electron workflow context). */
  projectId: MuggleUuidSchema.describe("Cloud project ID (UUID)"),
  /** Cloud use case ID (required for electron workflow context). */
  useCaseId: MuggleUuidSchema.describe("Cloud use case ID (UUID)"),
});

export type TestCaseDetails = z.infer<typeof TestCaseDetailsSchema>;

// ========================================
// Test Script Schema (from muggle-remote-test-script-get)
// ========================================

/**
 * Test script details schema.
 * These fields come from muggle-remote-test-script-get response.
 * Note: actionScript content is fetched separately via muggle-remote-action-script-get.
 */
export const TestScriptDetailsSchema = z.object({
  /** Cloud test script ID. */
  id: MuggleUuidSchema.describe("Cloud test script ID (UUID)"),
  /** Script name. */
  name: z.string().min(1).describe("Test script name"),
  /** Cloud test case ID this script belongs to. */
  testCaseId: MuggleUuidSchema.describe("Cloud test case ID (UUID) this script was generated from"),
  /** Action script ID reference (use muggle-remote-action-script-get to fetch content). */
  actionScriptId: MuggleUuidSchema.describe(
    "Action script ID (UUID) — use muggle-remote-action-script-get to fetch the full script",
  ),
  /** Original cloud URL (for reference, replaced by localUrl). */
  url: z.string().url().optional().describe("Original cloud URL (replaced by localUrl during execution)"),
  /** Cloud project ID (required for electron workflow context). */
  projectId: MuggleUuidSchema.describe("Cloud project ID (UUID)"),
  /** Cloud use case ID (required for electron workflow context). */
  useCaseId: MuggleUuidSchema.describe("Cloud use case ID (UUID)"),
});

export type TestScriptDetails = z.infer<typeof TestScriptDetailsSchema>;

// ========================================
// Execution Schemas
// ========================================

/**
 * Execute test generation input schema.
 * Accepts full test case details (from muggle-remote-test-case-get) plus local URL.
 */
export const ExecuteTestGenerationInputSchema = z.object({
  /** Test case details from muggle-remote-test-case-get. */
  testCase: TestCaseDetailsSchema.describe("Test case details obtained from muggle-remote-test-case-get"),
  /** Local URL to test against. */
  localUrl: z.string().url().describe("Local URL to test against (e.g., http://localhost:3000)"),
  /** Explicit approval to launch electron-app. */
  approveElectronAppLaunch: z.boolean().describe("Set to true after the user explicitly approves launching electron-app"),
  /** Optional timeout. */
  timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds (default: 300000 = 5 min)"),
  /** Show the electron-app UI during execution. Ask the user before approving; true = visible window, false or omit = headless. */
  showUi: z.boolean().optional().describe("Show the electron-app UI during generation. Ask the user: true to watch the window, false or omit for headless."),
});

export type ExecuteTestGenerationInput = z.infer<typeof ExecuteTestGenerationInputSchema>;

/**
 * Execute replay input schema.
 * Accepts test script metadata and actionScript content (fetched separately).
 */
export const ExecuteReplayInputSchema = z.object({
  /** Test script metadata from muggle-remote-test-script-get. */
  testScript: TestScriptDetailsSchema.describe("Test script metadata from muggle-remote-test-script-get"),
  /** Action script content from muggle-remote-action-script-get (using testScript.actionScriptId). */
  actionScript: z.array(z.unknown()).describe("Action script steps from muggle-remote-action-script-get"),
  /** Local URL to test against. */
  localUrl: z.string().url().describe("Local URL to test against (e.g., http://localhost:3000)"),
  /** Explicit approval to launch electron-app. */
  approveElectronAppLaunch: z.boolean().describe("Set to true after the user explicitly approves launching electron-app"),
  /** Optional timeout. */
  timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds (default: 180000 = 3 min)"),
  /** Show the electron-app UI during execution. Ask the user before approving; true = visible window, false or omit = headless. */
  showUi: z.boolean().optional().describe("Show the electron-app UI during replay. Ask the user: true to watch the window, false or omit for headless."),
});

export type ExecuteReplayInput = z.infer<typeof ExecuteReplayInputSchema>;

/**
 * Cancel execution input schema.
 */
export const CancelExecutionInputSchema = z.object({
  runId: MuggleUuidSchema.describe("Run ID (UUID) to cancel"),
});

export type CancelExecutionInput = z.infer<typeof CancelExecutionInputSchema>;

// ========================================
// Run Result Schemas
// ========================================

/**
 * Run result list input schema.
 */
export const RunResultListInputSchema = z.object({
  cloudTestCaseId: MuggleUuidSchema.optional().describe("Optional cloud test case ID (UUID) to filter by"),
  limit: z.number().int().positive().optional().describe("Maximum results to return (default: 20)"),
});

export type RunResultListInput = z.infer<typeof RunResultListInputSchema>;

/**
 * Run result get input schema.
 */
export const RunResultGetInputSchema = z.object({
  runId: MuggleUuidSchema.describe("Run result ID (UUID) to retrieve"),
});

export type RunResultGetInput = z.infer<typeof RunResultGetInputSchema>;

// ========================================
// Test Script Schemas
// ========================================

/**
 * Test script list input schema.
 */
export const TestScriptListInputSchema = z.object({
  cloudTestCaseId: MuggleUuidSchema.optional().describe("Optional cloud test case ID (UUID) to filter by"),
});

export type TestScriptListInput = z.infer<typeof TestScriptListInputSchema>;

/**
 * Test script get input schema.
 */
export const TestScriptGetInputSchema = z.object({
  testScriptId: MuggleUuidSchema.describe("Local stored test script ID (UUID) to retrieve"),
});

export type TestScriptGetInput = z.infer<typeof TestScriptGetInputSchema>;

// ========================================
// Publishing Schemas
// ========================================

/**
 * Publish test script input schema.
 * Uses local run ID to find the generated script and cloud IDs for where to publish.
 */
export const PublishTestScriptInputSchema = z.object({
  runId: MuggleUuidSchema.describe("Local run result ID (UUID) from muggle_execute_test_generation"),
  cloudTestCaseId: MuggleUuidSchema.describe("Cloud test case ID (UUID) to publish the script under"),
});

export type PublishTestScriptInput = z.infer<typeof PublishTestScriptInputSchema>;
