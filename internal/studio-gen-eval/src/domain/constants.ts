import { FailureBucket, WorkflowRunStatus } from "./types.js";

export const DEFAULT_RUNS = 5;
export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_REP_TIMEOUT_MS = 8 * 60 * 1000;
export const POLL_INTERVAL_MS = 5000;

/** Workflow states at which polling stops. */
export const TERMINAL_WORKFLOW_STATES: ReadonlySet<string> = new Set([
  WorkflowRunStatus.Completed,
  WorkflowRunStatus.Failed,
  WorkflowRunStatus.Cancelled,
  WorkflowRunStatus.Timeout,
]);

/**
 * Keyword → bucket map for classifying a studio failure's free-text reason.
 * Heuristic and order-sensitive: first match wins. Extend as new recurring
 * reasons are recognised.
 */
export const FAILURE_KEYWORDS: ReadonlyArray<readonly [FailureBucket, readonly string[]]> = [
  [FailureBucket.SecretInputUnresolved, ["secret", "label data slot", "could not resolve", "cannot be resolved"]],
  [FailureBucket.ElementIndexDrift, ["element index", "index out of", "stale element", "no element at index", "element not found"]],
  [FailureBucket.DatePickerGap, ["date picker", "datepicker", "native picker", "calendar widget"]],
  [FailureBucket.ScrollContainerBlindness, ["scroll container", "not scrollable", "could not scroll", "scroll target"]],
];

/** Buckets that represent infrastructure, not studio generation quality. */
export const INFRA_BUCKETS: ReadonlySet<FailureBucket> = new Set([
  FailureBucket.AccountLockout,
  FailureBucket.InvalidCredentials,
  FailureBucket.Timeout,
  FailureBucket.Crash,
]);
