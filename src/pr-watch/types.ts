/**
 * The fields of one PR's `last_seen.json` entry that decide whether the watch dispatches, floors, or holds.
 * Keys keep the on-disk snake_case spelling the skill prose writes.
 */
export interface LastSeenPrEntry {
  conflict_resolve_attempts?: Record<string, number>;
  conflict_escalated_keys?: string[];
  ci_fix_attempts?: Record<string, number>;
  ci_escalated_shas?: string[];
  ci_rerun_shas?: string[];
  catch_up_rebases?: number;
  rebase_budget_exhausted?: boolean;
  escalated_review_ids?: number[];
  blocked?: { fingerprint?: { ci_digest?: unknown } };
}

/** The single PR a slot's `prs.json` tracks, narrowed to the fields the watch reads. */
export interface SlotPrRecord {
  repo?: string;
  number?: number;
  url?: string;
  head_sha?: string;
  state?: string;
}

/** A PR head's CI rollup, folded the way `_shared/vcs/common/ci-rollup.md` folds it. */
export enum CiRollupBucket {
  Red = "red",
  Pending = "pending",
  Green = "green",
}

/** What a watcher tick does once no review feedback is actionable: dispatch a cycle, hold on a durable block, or idle. */
export enum WatchTickVerdict {
  DispatchRebase = "dispatch-rebase",
  DispatchFixCi = "dispatch-fix-ci",
  BlockRebaseBudgetExhausted = "block-rebase-budget-exhausted",
  BlockConflictEscalated = "block-conflict-escalated",
  BlockCiEscalated = "block-ci-escalated",
  BlockReviewsEscalated = "block-reviews-escalated",
  Idle = "idle",
}

/** The branch and CI standing one tick read from the provider. */
export interface WatchTickObservation {
  headSha: string;
  rebaseKey: string;
  isRebaseDue: boolean;
  ciBucket: CiRollupBucket;
}

/** The muggle preferences the watch acts on, resolved against the shipped defaults. */
export interface WatchPreferences {
  /** The `autoRebase` value, undefined when no preference or default could be read. */
  autoRebase?: string;
  /** The `maxCatchUpRebases` cap; null when unbounded (`never`) or unreadable. */
  maxCatchUpRebases: number | null;
}

/** What the arm step needs to decide which outstanding work it may floor as already handled. */
export interface ArmFloorEvidence {
  isRebaseKeyAttempted: boolean;
  /** Fix-ci escalated the head or spent its attempts on it, so its red verdict is no longer news. */
  isCiHeadSettled: boolean;
  /** The PR spent its catch-up rebase budget, so the tick refuses any rebase and the watch holds rebase wakes. */
  isRebaseBudgetExhausted: boolean;
  /** The blocked fingerprint's CI digest, empty when the PR is not blocked or the digest could forge a watermark line. */
  blockedCiDigest: string;
}

/** The subcommands of `pr-watch-verdict.mjs`. */
export enum PrWatchVerdictCommand {
  /** Which outstanding work the arm step may floor, for `pr-watch-arm.sh`. */
  ArmFloors = "arm-floors",
  /** The tick's dispatch-or-hold verdict, for `contract.md` Steps 5-7. */
  Tick = "tick",
}

/** The `--flag value` pairs a `pr-watch-verdict.mjs` invocation carries, by flag name without the dashes. */
export type PrWatchVerdictArguments = Record<string, string>;

/** What one `pr-watch-verdict.mjs` invocation prints and exits with. */
export interface PrWatchVerdictOutcome {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** The work a slot's watch last saw due on its PR, as `watch-due.env` records it. */
export interface WatchDueRecord {
  headSha: string;
  /** The `<head>..<base-tip>` key of a rebase found due, empty when the branch is current. */
  rebaseDueKey: string;
  /** The head whose checks settled red, empty when CI is green or still pending. */
  ciRedHeadSha: string;
}
