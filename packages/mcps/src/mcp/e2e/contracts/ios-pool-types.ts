/** Who uploaded an iOS build; stamped explicitly by the uploader, never inferred by the pool. */
export enum IosArtifactProducerEnum {
  /** Dragged into the dashboard by a person. */
  DashboardUpload = "dashboard_upload",
  /** Pushed by an automated pipeline: a customer's CI or an agent through this MCP. */
  CiPush = "ci_push",
}

/** Machinery state of an iOS run; says nothing about whether the app under test passed. */
export enum IosRunStatusEnum {
  Queued = "queued",
  Claimed = "claimed",
  Running = "running",
  Completed = "completed",
  InfraError = "infra_error",
  TimedOut = "timed_out",
  Cancelled = "cancelled",
}

/** Test outcome of a completed iOS run, published by the host beside the machinery status. */
export enum IosRunVerdictEnum {
  Passed = "passed",
  Failed = "failed",
  GoalUnachievable = "goal_unachievable",
}
