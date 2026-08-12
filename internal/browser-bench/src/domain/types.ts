/** One benchmark task: an instruction to complete starting from a URL. */
export interface BenchmarkTask {
  taskId: string;
  siteName: string;
  instruction: string;
  startUrl: string;
}

/** How a single task attempt is counted toward (or excluded from) the score. */
export enum BenchmarkOutcome {
  Pass = "pass",
  Fail = "fail",
  Error = "error",
}

/** One task attempt's recorded result. */
export interface TaskResult {
  taskId: string;
  outcome: BenchmarkOutcome;
  finalAnswer: string;
  studioStatus: string;
  judgeVerdict?: BenchmarkOutcome;
  judgeReasoning?: string;
  stepCount: number;
  durationMs: number;
  /** Prompt + completion tokens the attempt consumed, so a score is always reportable next to its cost. */
  tokensUsed: number;
  errorReason?: string;
  trajectoryDir: string;
}
