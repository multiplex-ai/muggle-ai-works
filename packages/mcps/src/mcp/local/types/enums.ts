/**
 * Enums for local E2E acceptance module.
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

/**
 * Browser resolutions a run can execute at. Values mirror the cloud's
 * `DisplayResolutionEnum` verbatim so a resolution stamped on a cloud test case
 * means the same thing on the local lane.
 */
export enum DisplayResolution {
  /** 800 x 600 — PC. */
  R_0800x0600 = "R_0800x0600",
  /** 1024 x 768 — PC. */
  R_1024x0768 = "R_1024x0768",
  /** 390 x 844 — phone. */
  R_0390x0844 = "R_0390x0844",
  /** 1920 x 1080 — PC. */
  R_1920x1080 = "R_1920x1080",
  /** 360 x 800 — phone. */
  R_0360x0800 = "R_0360x0800",
  /** 393 x 852 — phone. */
  R_0393x0852 = "R_0393x0852",
  /** 430 x 932 — phone. */
  R_0430x0932 = "R_0430x0932",
  /** 768 x 1024 — iPad. */
  R_0768x1024 = "R_0768x1024",
  /** 820 x 1180 — iPad. */
  R_0820x1180 = "R_0820x1180",
  /** 1024 x 1366 — iPad. */
  R_1024x1366 = "R_1024x1366",
  /** 1440 x 900 — MacBook. */
  R_1440x0900 = "R_1440x0900",
  /** 1512 x 982 — MacBook. */
  R_1512x0982 = "R_1512x0982",
  /** 1728 x 1117 — MacBook. */
  R_1728x1117 = "R_1728x1117",
  /** 1366 x 768 — PC. */
  R_1366x0768 = "R_1366x0768",
  /** 1536 x 864 — PC. */
  R_1536x0864 = "R_1536x0864",
  /** 2560 x 1440 — PC. */
  R_2560x1440 = "R_2560x1440",
}
