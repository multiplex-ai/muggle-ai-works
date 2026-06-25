import { FAILURE_KEYWORDS, TERMINAL_WORKFLOW_STATES } from "./constants.js";
import {
  type BackendRunData,
  type CaseSummary,
  FailureBucket,
  type GoldenCase,
  OutcomeClass,
  type RepResult,
  type RepVerdict,
  RunFailureReasonType,
  StudioResultStatus,
  WorkflowRunStatus,
} from "./types.js";

/** A run is done when its workflow status is terminal. */
export function isTerminal(status: string | undefined): boolean {
  return status !== undefined && TERMINAL_WORKFLOW_STATES.has(status);
}

function bucketFromText(text: string): FailureBucket {
  const t = text.toLowerCase();
  for (const [bucket, keywords] of FAILURE_KEYWORDS) {
    if (keywords.some((k) => t.includes(k))) return bucket;
  }
  return FailureBucket.UnclassifiedFail;
}

/**
 * Classify one run into pass / fail / error. The studio verdict drives the call
 * when present; infra and account reasons resolve to `error` so they never count
 * against the studio pass-rate. `localTimeout` marks a run that never reached a
 * terminal state within the per-rep budget.
 *
 * Returns e.g. `{ outcome: OutcomeClass.Fail, bucket: FailureBucket.ElementIndexDrift, reason: "no element at index 4" }`.
 */
export function classifyRun (
  run: BackendRunData | null,
  opts: { localTimeout?: boolean } = {},
): RepVerdict {
  if (opts.localTimeout) {
    return { outcome: OutcomeClass.Error, bucket: FailureBucket.Timeout, reason: "poll timeout: no terminal state within budget" };
  }
  if (run === null) {
    return { outcome: OutcomeClass.Error, bucket: FailureBucket.Crash, reason: "no run data returned" };
  }

  const studio = run.studioReturnedResult;
  const failure = studio?.structuredSummary?.failure ?? null;
  const reasonType = failure?.reason?.type ?? null;
  const reasonText =
    failure?.reason?.text ||
    studio?.structuredSummary?.failureReason ||
    studio?.error ||
    run.error ||
    studio?.summary ||
    "";

  if (reasonType === RunFailureReasonType.AccountBlocked || reasonType === RunFailureReasonType.AccountDisabled) {
    return { outcome: OutcomeClass.Error, bucket: FailureBucket.AccountLockout, reason: reasonText || String(reasonType) };
  }
  if (reasonType === RunFailureReasonType.InvalidCredentials) {
    return { outcome: OutcomeClass.Error, bucket: FailureBucket.InvalidCredentials, reason: reasonText || String(reasonType) };
  }

  switch (studio?.status) {
    case StudioResultStatus.Success:
      return { outcome: OutcomeClass.Pass };
    case StudioResultStatus.Timeout:
      return { outcome: OutcomeClass.Error, bucket: FailureBucket.Timeout, reason: reasonText || "studio timeout" };
    case StudioResultStatus.Failure:
    case StudioResultStatus.GoalNotAchievable:
      return { outcome: OutcomeClass.Fail, bucket: bucketFromText(reasonText), reason: reasonText || String(studio.status) };
    default:
      break;
  }

  // No studio verdict: fall back to the workflow status. A terminal run with no
  // verdict is untrustworthy, so it is an error rather than a studio failure.
  switch (run.status) {
    case WorkflowRunStatus.Timeout:
      return { outcome: OutcomeClass.Error, bucket: FailureBucket.Timeout, reason: run.error || "workflow timeout" };
    case WorkflowRunStatus.Cancelled:
      return { outcome: OutcomeClass.Error, bucket: FailureBucket.Crash, reason: run.error || "cancelled" };
    case WorkflowRunStatus.Completed:
      return { outcome: OutcomeClass.Error, bucket: FailureBucket.Crash, reason: run.error || "completed without a studio verdict" };
    default:
      return { outcome: OutcomeClass.Error, bucket: FailureBucket.Crash, reason: run.error || "workflow failed without a verdict" };
  }
}

function tallyBuckets (reps: RepResult[]): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (const r of reps) {
    if (r.bucket) buckets[r.bucket] = (buckets[r.bucket] ?? 0) + 1;
  }
  return buckets;
}

/**
 * Pass-rate over the reps that produced a trustworthy verdict (pass + fail).
 * Errors are excluded from the denominator so infra noise can't move the number.
 */
export function passRate (passes: number, fails: number): number {
  const scored = passes + fails;
  return scored === 0 ? 0 : passes / scored;
}

/** Roll a case's reps into a per-case summary. */
export function summariseCase (testCaseId: string, title: string, reps: RepResult[]): CaseSummary {
  const passes = reps.filter((r) => r.outcome === OutcomeClass.Pass).length;
  const fails = reps.filter((r) => r.outcome === OutcomeClass.Fail).length;
  const errors = reps.filter((r) => r.outcome === OutcomeClass.Error).length;
  return {
    testCaseId: testCaseId,
    title: title,
    reps: reps.length,
    passes: passes,
    fails: fails,
    errors: errors,
    passRate: passRate(passes, fails),
    buckets: tallyBuckets(reps),
  };
}

/** Resolve a case's display title for a summary, falling back to its id. */
export function caseTitle (golden: GoldenCase | undefined, testCaseId: string): string {
  return golden?.title || testCaseId;
}
