/**
 * Supported workflow execution status values.
 */
export type TWorkflowStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * Workflow definition metadata.
 */
export interface IWorkflowDefinition {
  /**
   * Unique workflow identifier.
   */
  workflowId: string;
  /**
   * Human-readable workflow name.
   */
  name: string;
  /**
   * Optional description.
   */
  description?: string;
}

/**
 * Workflow run metadata.
 */
export interface IWorkflowRunSummary {
  /**
   * Unique run identifier.
   */
  workflowRunId: string;
  /**
   * Parent workflow identifier.
   */
  workflowId: string;
  /**
   * Current run status.
   */
  status: TWorkflowStatus;
}
