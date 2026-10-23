/** One failure-mode event line: how a skill classified a replay/regen situation and what the user chose. */
export interface IFailureEventRecord {
  ts: string;
  eventType: string;
  skillName: string;
  aiClassification?: string;
  aiSuggestion?: string;
  userAction?: string;
  runId?: string;
  testCaseId?: string;
  projectId?: string;
  signals?: string[];
  metadata?: Record<string, unknown>;
}

/** One workflow event line: a telemetry-catalog event, its catalog payload carried in `metadata`. */
export interface IWorkflowEventRecord {
  ts: string;
  eventType: string;
  skillName: string;
  metadata?: Record<string, unknown>;
}
