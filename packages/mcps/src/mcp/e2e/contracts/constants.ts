/**
 * Appended to every workflow runtime id field so agents do not pass a run id, which the
 * backend treats as an unknown runtime.
 */
export const WORKFLOW_RUNTIME_ID_NOT_RUN_ID_HINT =
  "Use the `workflowRuntimeId` returned when the workflow was started — not a run `id` or a test runs summary's `latestWorkflowRunId`, which are run ids and are not found here.";

/** Fewest account sets a project's batch may run at once. */
export const TEST_STATE_PARALLEL_ACCOUNT_SET_LIMIT_MIN = 1;

/** Most account sets a project's batch may run at once. */
export const TEST_STATE_PARALLEL_ACCOUNT_SET_LIMIT_MAX = 20;

/** Parallel account set limit of a project that never set one. */
export const TEST_STATE_PARALLEL_ACCOUNT_SET_LIMIT_DEFAULT = 5;
