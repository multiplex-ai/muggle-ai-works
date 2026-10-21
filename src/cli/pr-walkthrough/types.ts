/** Conclusion published on the PR's check run. */
export enum CheckConclusion {
  Success = "success",
  Failure = "failure",
  Neutral = "neutral",
}

/** What the check found on the PR, before it is mapped to a conclusion. */
export enum WalkthroughCheckOutcome {
  /** A walkthrough whose every case passed, a legacy walkthrough with no result record, or a verified skip. */
  Settled = "settled",
  /** The walkthrough reports at least one failed or inconclusive case. */
  E2eNotPassing = "e2e-not-passing",
  /** The designated comment is still empty, or the PR has none. */
  Unsettled = "unsettled",
  /** The PR's comments could not be read. */
  Unreadable = "unreadable",
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
  outcome: WalkthroughCheckOutcome;
  conclusion: CheckConclusion;
  exitCode: number;
  summary: string;
}
