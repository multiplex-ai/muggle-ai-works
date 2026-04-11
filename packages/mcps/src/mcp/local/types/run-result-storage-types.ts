/**
 * Types for run-result file storage (run-results/ and test-scripts/ JSON artifacts).
 * Distinct from project-types ILocalTestScript (full project entity model).
 */

/**
 * Run result status.
 */
export type RunResultStatus = "pending" | "running" | "passed" | "failed" | "cancelled";

/**
 * Run result type.
 */
export type RunResultType = "generation" | "replay";

/**
 * Local execution context captured during local run execution.
 */
export interface ILocalExecutionContext {
  /** URL executed locally (typically localhost). */
  originalUrl: string;
  /** Cloud production URL associated with the test case/script. */
  productionUrl: string;
  /** User ID who ran the local execution. */
  runByUserId: string;
  /** Machine hostname for the local execution environment. */
  machineHostname?: string;
  /** OS information for local execution environment. */
  osInfo?: string;
  /** Electron app version used for local execution. */
  electronAppVersion?: string;
  /** MCP server version used for local execution. */
  mcpServerVersion?: string;
  /** Local execution completion timestamp (epoch ms). */
  localExecutionCompletedAt?: number;
}

/**
 * Run result record persisted under run-results/.
 */
export interface IRunResult {
  /** Unique run ID (UUID, aligned with cloud IWorkflowRunData.id). */
  id: string;
  /** Run type. */
  runType: RunResultType;
  /** Run status. */
  status: RunResultStatus;
  /** Cloud test case ID. */
  cloudTestCaseId: string;
  /** Cloud project ID. */
  projectId: string;
  /** Cloud use case ID. */
  useCaseId: string;
  /** Local URL used for testing. */
  localUrl: string;
  /** Cloud production URL for the same test. */
  productionUrl: string;
  /** Local execution context details. */
  localExecutionContext: ILocalExecutionContext;
  /** Associated test script ID (if generated). */
  testScriptId?: string;
  /** Path to run artifacts directory (action script, screenshots, results). */
  artifactsDir?: string;
  /** Execution time in ms. */
  executionTimeMs?: number;
  /** Error message if failed. */
  errorMessage?: string;
  /** Created timestamp. */
  createdAt: string;
  /** Updated timestamp. */
  updatedAt: string;
  /** Studio returned result (populated by electron-app after execution). */
  studioReturnedResult?: unknown;
}

/**
 * Test script status for persisted test-scripts/*.json records.
 */
export type TestScriptStatus = "pending" | "generated" | "published" | "failed";

/**
 * Test script record persisted under test-scripts/ (run-result storage).
 */
export interface IRunResultStorageTestScript {
  /**
   * Unique local test script ID (UUID).
   * Used as actionScriptId / testScriptId in local generation payloads; aligns with cloud action script IDs.
   */
  id: string;
  /** Script name. */
  name: string;
  /** Target URL. */
  url: string;
  /** Script status. */
  status: TestScriptStatus;
  /** Cloud test case ID. */
  cloudTestCaseId: string;
  /** Test goal. */
  goal?: string;
  /** Action script steps. */
  actionScript?: unknown[];
  /** Optional summary step capturing run verdict, structured summary, and final screenshot. */
  summaryStep?: unknown;
  /** Cloud action script ID (if published). */
  cloudActionScriptId?: string;
  /** Created timestamp. */
  createdAt: string;
  /** Updated timestamp. */
  updatedAt: string;
}
