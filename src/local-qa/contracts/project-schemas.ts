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
 * (fetched via qa_* tools), not just IDs. This keeps local tools free of
 * cloud dependencies.
 */

import { z } from "zod";

// ========================================
// Test Case Schema (from qa_test_case_get)
// ========================================

/**
 * Test case details schema.
 * These fields come from qa_test_case_get response.
 */
export const TestCaseDetailsSchema = z.object({
  /** Cloud test case ID. */
  id: z.string().min(1).describe("Cloud test case ID"),
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
  projectId: z.string().min(1).describe("Cloud project ID"),
  /** Cloud use case ID (required for electron workflow context). */
  useCaseId: z.string().min(1).describe("Cloud use case ID"),
});

export type TestCaseDetails = z.infer<typeof TestCaseDetailsSchema>;

// ========================================
// Test Script Schema (from qa_test_script_get)
// ========================================

/**
 * Test script details schema.
 * These fields come from qa_test_script_get response.
 */
export const TestScriptDetailsSchema = z.object({
  /** Cloud test script ID. */
  id: z.string().min(1).describe("Cloud test script ID"),
  /** Script name. */
  name: z.string().min(1).describe("Test script name"),
  /** Cloud test case ID this script belongs to. */
  testCaseId: z.string().min(1).describe("Cloud test case ID this script was generated from"),
  /** Action script steps. */
  actionScript: z.array(z.unknown()).describe("Action script steps to replay"),
  /** Original cloud URL (for reference, replaced by localUrl). */
  url: z.string().url().optional().describe("Original cloud URL (replaced by localUrl during execution)"),
  /** Cloud project ID (required for electron workflow context). */
  projectId: z.string().min(1).describe("Cloud project ID"),
  /** Cloud use case ID (required for electron workflow context). */
  useCaseId: z.string().min(1).describe("Cloud use case ID"),
});

export type TestScriptDetails = z.infer<typeof TestScriptDetailsSchema>;

// ========================================
// Execution Schemas
// ========================================

/**
 * Execute test generation input schema.
 * Accepts full test case details (from qa_test_case_get) plus local URL.
 */
export const ExecuteTestGenerationInputSchema = z.object({
  /** Test case details from qa_test_case_get. */
  testCase: TestCaseDetailsSchema.describe("Test case details obtained from qa_test_case_get"),
  /** Local URL to test against. */
  localUrl: z.string().url().describe("Local URL to test against (e.g., http://localhost:3000)"),
  /** Explicit approval to launch electron-app. */
  approveElectronAppLaunch: z.boolean().describe("Set to true after the user explicitly approves launching electron-app"),
  /** Optional timeout. */
  timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds (default: 300000 = 5 min)"),
});

export type ExecuteTestGenerationInput = z.infer<typeof ExecuteTestGenerationInputSchema>;

/**
 * Execute replay input schema.
 * Accepts full test script details (from qa_test_script_get) plus local URL.
 */
export const ExecuteReplayInputSchema = z.object({
  /** Test script details from qa_test_script_get. */
  testScript: TestScriptDetailsSchema.describe("Test script details obtained from qa_test_script_get"),
  /** Local URL to test against. */
  localUrl: z.string().url().describe("Local URL to test against (e.g., http://localhost:3000)"),
  /** Explicit approval to launch electron-app. */
  approveElectronAppLaunch: z.boolean().describe("Set to true after the user explicitly approves launching electron-app"),
  /** Optional timeout. */
  timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds (default: 180000 = 3 min)"),
});

export type ExecuteReplayInput = z.infer<typeof ExecuteReplayInputSchema>;

/**
 * Cancel execution input schema.
 */
export const CancelExecutionInputSchema = z.object({
  runId: z.string().min(1).describe("Run ID to cancel"),
});

export type CancelExecutionInput = z.infer<typeof CancelExecutionInputSchema>;

// ========================================
// Run Result Schemas
// ========================================

/**
 * Run result list input schema.
 */
export const RunResultListInputSchema = z.object({
  cloudTestCaseId: z.string().optional().describe("Optional cloud test case ID to filter by"),
  limit: z.number().int().positive().optional().describe("Maximum results to return (default: 20)"),
});

export type RunResultListInput = z.infer<typeof RunResultListInputSchema>;

/**
 * Run result get input schema.
 */
export const RunResultGetInputSchema = z.object({
  runId: z.string().min(1).describe("Run result ID to retrieve"),
});

export type RunResultGetInput = z.infer<typeof RunResultGetInputSchema>;

// ========================================
// Test Script Schemas
// ========================================

/**
 * Test script list input schema.
 */
export const TestScriptListInputSchema = z.object({
  cloudTestCaseId: z.string().optional().describe("Optional cloud test case ID to filter by"),
});

export type TestScriptListInput = z.infer<typeof TestScriptListInputSchema>;

/**
 * Test script get input schema.
 */
export const TestScriptGetInputSchema = z.object({
  testScriptId: z.string().min(1).describe("Test script ID to retrieve"),
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
  runId: z.string().min(1).describe("Local run result ID from muggle_execute_test_generation"),
  cloudTestCaseId: z.string().min(1).describe("Cloud test case ID to publish the script under"),
});

export type PublishTestScriptInput = z.infer<typeof PublishTestScriptInputSchema>;
