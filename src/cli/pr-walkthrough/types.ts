/** Conclusion published on the PR's check run. */
export enum CheckConclusion {
  Success = "success",
  Failure = "failure",
  Neutral = "neutral",
}

/** What one invocation of the check was asked to judge. */
export interface PrWalkthroughCheckOptions {
  repo: string;
  prNumber: number;
  headSha: string;
  publishCheckRun: boolean;
}

/** The judgment, and how the process should exit on it. */
export interface PrWalkthroughCheckResult {
  conclusion: CheckConclusion;
  exitCode: number;
  summary: string;
}
