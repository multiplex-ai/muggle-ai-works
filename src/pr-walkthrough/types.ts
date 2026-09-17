/** What one PR comment is, as far as the walkthrough slot is concerned. */
export enum WalkthroughCommentStatus {
  NotDesignated = "not-designated",
  Pending = "pending",
  Reported = "reported",
  Skipped = "skipped",
}

/** Whether a PR's designated comment discharges the walkthrough duty. */
export enum WalkthroughVerdict {
  Missing = "missing",
  Pending = "pending",
  Satisfied = "satisfied",
}

/** The fields of a PR comment the walkthrough logic reads. */
export interface PrComment {
  id: number;
  body: string;
}

/** The PR a provider call addresses. */
export interface PrCoordinates {
  repo: string;
  prNumber: number;
}

/** Runs a `gh` invocation, optionally feeding stdin; `null` when the call could not be made. */
export type GhRunner = (args: string[], input?: string) => string | null;
