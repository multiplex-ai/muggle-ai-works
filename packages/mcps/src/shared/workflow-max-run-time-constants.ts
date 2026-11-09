/** Shortest max runtime override the backend accepts. */
export const MIN_WORKFLOW_MAX_RUN_TIME_OVERRIDE_MS = 60 * 1000;

/** Longest max runtime override the backend accepts. */
export const MAX_WORKFLOW_MAX_RUN_TIME_OVERRIDE_MS = 60 * 60 * 1000;

/** Agent-facing description of the remote `workflowParams.maxRunTimeMs` override. */
export const WORKFLOW_MAX_RUN_TIME_PARAMS_DESCRIPTION =
  "Max runtime per workflow kind, in milliseconds (60000–3600000). The run fails as timed out once it exceeds this. Omit a kind to inherit the project/use case/test case setting, else its built-in limit.";
