/** One benchmark task: an instruction to complete starting from a URL. */
export interface BenchmarkTask {
  taskId: string;
  siteName: string;
  instruction: string;
  startUrl: string;
}

/**
 * How a single task attempt is counted toward (or excluded from) the score.
 *
 * `Pass` and `Fail` are the whole scored denominator. `Error` (the harness or
 * studio failed) and `Blocked` (the site refused the agent with a bot-defence
 * interstitial, so its capability was never exercised) are both counted and
 * reported, never scored — neither measures what the agent can do.
 */
export enum BenchmarkOutcome {
  Pass = "pass",
  Fail = "fail",
  Error = "error",
  Blocked = "blocked",
}

/**
 * Who supplies the model for a batch's studio processes, as studio's `MUGGLE_LLM_PROVIDER`
 * names it. `Anthropic` is the API on the operator's own key; `ClaudeCode` is the operator's
 * own installed Claude Code.
 */
export enum ModelSource {
  Anthropic = "anthropic",
  ClaudeCode = "claude-code",
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
  /** The source studio confirmed it ran on; absent when the batch left the choice to studio's default. */
  modelSource?: ModelSource;
}
