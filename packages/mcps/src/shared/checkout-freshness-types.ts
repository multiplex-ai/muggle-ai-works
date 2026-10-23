/** Shapes for the checkout-freshness check. */

/** Whether a checkout is built on the latest base branch. */
export enum CheckoutFreshnessVerdict {
  /** HEAD contains the base tip and the branch was not cut from unmerged work. */
  Fresh = "FRESH",
  /** HEAD lacks the base tip. */
  BehindBase = "BEHIND_BASE",
  /** The branch was created on a commit the base lacks, and still carries it. */
  ForeignBase = "FOREIGN_BASE",
  /** Not a git checkout, no `origin` remote, or no resolvable base — nothing to check. */
  NotApplicable = "NOT_APPLICABLE",
}

/**
 * Runs one git command in a directory.
 *
 * @returns Trimmed stdout, or null when git exits non-zero or cannot start.
 */
export type GitCommandRunner = (args: string[], cwd: string) => Promise<string | null>;

/** Inputs to a freshness check. */
export interface ICheckoutFreshnessRequest {
  /** Any directory inside the checkout. */
  cwd: string;
  /** Branch the checkout merges into; the remote's default branch when omitted. */
  baseBranch?: string;
  /** Fetch the base from `origin` first. Off for checks that must not touch the network. */
  shouldFetchBase: boolean;
  runGit: GitCommandRunner;
}

/**
 * Result of a freshness check.
 *
 * Output shape:
 * `{ verdict: "BEHIND_BASE", reason: "HEAD is 3 commits behind origin/master", checkoutRoot: "/repo/.claude/worktrees/x",
 *   mainWorktreeRoot: "/repo", branch: "users/me/x", headSha: "…", baseRef: "refs/remotes/origin/master", baseSha: "…",
 *   behindBy: 3, creationSha: "…", inheritedCommitCount: 0, inheritedCommits: [], hasFetchFailed: false }`
 */
export interface ICheckoutFreshnessReport {
  verdict: CheckoutFreshnessVerdict;
  /** One sentence naming what decided the verdict. */
  reason: string;
  checkoutRoot: string | null;
  /** Root of the clone's main working tree — the same for every worktree of one clone. */
  mainWorktreeRoot: string | null;
  /** Checked-out branch; null when HEAD is detached. */
  branch: string | null;
  headSha: string | null;
  /** Full ref the base resolved to, e.g. `refs/remotes/origin/master`. */
  baseRef: string | null;
  baseSha: string | null;
  /** Base commits HEAD lacks. */
  behindBy: number;
  /** Commit the branch was created on, when its reflog still records the creation. */
  creationSha: string | null;
  /** Commits the branch inherited at creation that the base lacks. */
  inheritedCommitCount: number;
  /** `<short sha> <subject>` of the first inherited commits, newest first. */
  inheritedCommits: string[];
  /** True when a requested fetch failed; the verdict then reflects the last fetched base. */
  hasFetchFailed: boolean;
}
