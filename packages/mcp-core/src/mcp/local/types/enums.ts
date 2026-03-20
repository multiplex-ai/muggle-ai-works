/**
 * Enums for local QA module.
 */

/**
 * Device code poll status values.
 */
export enum DeviceCodePollStatus {
  /** Authorization is still pending. */
  Pending = "pending",
  /** Authorization completed successfully. */
  Complete = "complete",
  /** The device code has expired. */
  Expired = "expired",
  /** An error occurred during polling. */
  Error = "error",
}

/**
 * Session status values.
 */
export enum SessionStatus {
  /** Session is currently running. */
  Running = "running",
  /** Session completed successfully. */
  Completed = "completed",
  /** Session failed. */
  Failed = "failed",
}

/**
 * Local run status values.
 */
export enum LocalRunStatus {
  /** Run is pending execution. */
  PENDING = "pending",
  /** Run is currently executing. */
  RUNNING = "running",
  /** Run passed successfully. */
  PASSED = "passed",
  /** Run failed. */
  FAILED = "failed",
  /** Run was cancelled. */
  CANCELLED = "cancelled",
}

/**
 * Local run type values.
 */
export enum LocalRunType {
  /** Test script generation run. */
  GENERATION = "generation",
  /** Test script replay run. */
  REPLAY = "replay",
}

/**
 * Local test script status values.
 */
export enum LocalTestScriptStatus {
  /** Draft test script (not yet generated). */
  DRAFT = "draft",
  /** Generated test script. */
  GENERATED = "generated",
  /** Validated test script. */
  VALIDATED = "validated",
  /** Failed test script. */
  FAILED = "failed",
}

/**
 * Local workflow run status values.
 */
export enum LocalWorkflowRunStatus {
  /** Workflow run is pending. */
  PENDING = "pending",
  /** Workflow run is currently running. */
  RUNNING = "running",
  /** Workflow run completed successfully. */
  COMPLETED = "completed",
  /** Workflow run failed. */
  FAILED = "failed",
  /** Workflow run was cancelled. */
  CANCELLED = "cancelled",
}

/**
 * Cloud ID mapping entity types.
 */
export enum CloudMappingEntityType {
  /** Project entity. */
  PROJECT = "project",
  /** Use case entity. */
  USE_CASE = "use_case",
  /** Test case entity. */
  TEST_CASE = "test_case",
  /** Test script entity. */
  TEST_SCRIPT = "test_script",
}

/**
 * Local workflow file entity types.
 */
export enum LocalWorkflowFileEntityType {
  /** Project-level workflow file. */
  PROJECT = "project",
  /** Use case-level workflow file. */
  USE_CASE = "use_case",
  /** Test case-level workflow file. */
  TEST_CASE = "test_case",
}

/**
 * Execution status values.
 */
export enum ExecutionStatus {
  /** Execution is pending. */
  Pending = "pending",
  /** Execution is running. */
  Running = "running",
  /** Execution completed successfully. */
  Completed = "completed",
  /** Execution failed. */
  Failed = "failed",
  /** Execution was cancelled. */
  Cancelled = "cancelled",
}

/**
 * Health status values.
 */
export enum HealthStatus {
  /** Service is healthy. */
  Healthy = "healthy",
  /** Service is degraded. */
  Degraded = "degraded",
  /** Service is unhealthy. */
  Unhealthy = "unhealthy",
}

/**
 * Test result status values.
 */
export enum TestResultStatus {
  /** Test passed. */
  Passed = "passed",
  /** Test failed. */
  Failed = "failed",
  /** Test was skipped. */
  Skipped = "skipped",
}
