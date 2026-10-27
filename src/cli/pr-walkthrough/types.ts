/** Conclusion published on the PR's check run. */
export enum CheckConclusion {
  Success = "success",
  Failure = "failure",
  Neutral = "neutral",
}

/** Lifecycle state published on the PR's check run; only a completed run carries a {@link CheckConclusion}. */
export enum CheckRunStatus {
  InProgress = "in_progress",
  Completed = "completed",
}

/** What the check found on the PR, before it is mapped to a conclusion. */
export enum WalkthroughCheckOutcome {
  /** A walkthrough whose every case passed, a legacy walkthrough with no result record, or a verified skip. */
  Settled = "settled",
  /** The walkthrough reports at least one failed or inconclusive case. */
  E2eNotPassing = "e2e-not-passing",
  /** A new E2E run has started and will replace the walkthrough the comment still shows. */
  RerunInProgress = "rerun-in-progress",
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
  status: CheckRunStatus;
  /** `null` while the check run is in progress. */
  conclusion: CheckConclusion | null;
  exitCode: number;
  summary: string;
}
