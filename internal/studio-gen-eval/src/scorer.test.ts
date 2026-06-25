import { describe, expect, it } from "vitest";

import { classifyRun, isTerminal, passRate, summariseCase } from "./scorer.js";
import {
  type BackendRunData,
  FailureBucket,
  OutcomeClass,
  type RepResult,
  RunFailureReasonType,
  StudioResultStatus,
  WorkflowRunStatus,
} from "./types.js";

function run (over: Partial<BackendRunData>): BackendRunData {
  return { id: "run-1", status: WorkflowRunStatus.Completed, ...over };
}

function studioFailure (text: string): BackendRunData {
  return run({
    studioReturnedResult: {
      status: StudioResultStatus.Failure,
      structuredSummary: { failure: { reason: { text: text, type: null } } },
    },
  });
}

describe("isTerminal", () => {
  it("treats completed/failed/cancelled/timeout as terminal, pending/running as not", () => {
    expect(isTerminal(WorkflowRunStatus.Completed)).toBe(true);
    expect(isTerminal(WorkflowRunStatus.Failed)).toBe(true);
    expect(isTerminal(WorkflowRunStatus.Cancelled)).toBe(true);
    expect(isTerminal(WorkflowRunStatus.Timeout)).toBe(true);
    expect(isTerminal(WorkflowRunStatus.Pending)).toBe(false);
    expect(isTerminal(WorkflowRunStatus.Running)).toBe(false);
    expect(isTerminal(undefined)).toBe(false);
  });
});

describe("classifyRun", () => {
  it("studio success is a pass", () => {
    expect(classifyRun(run({ studioReturnedResult: { status: StudioResultStatus.Success } })).outcome).toBe(OutcomeClass.Pass);
  });

  it("studio failure / goal-not-achievable is a fail, bucketed from the reason text", () => {
    expect(classifyRun(studioFailure("no element at index 4")).bucket).toBe(FailureBucket.ElementIndexDrift);
    expect(classifyRun(studioFailure("could not resolve secret API_KEY")).bucket).toBe(FailureBucket.SecretInputUnresolved);
    expect(classifyRun(studioFailure("the native date picker never opened")).bucket).toBe(FailureBucket.DatePickerGap);
    expect(classifyRun(studioFailure("scroll container not found")).bucket).toBe(FailureBucket.ScrollContainerBlindness);
    const unknown = classifyRun(studioFailure("something odd happened"));
    expect(unknown.outcome).toBe(OutcomeClass.Fail);
    expect(unknown.bucket).toBe(FailureBucket.UnclassifiedFail);
    expect(
      classifyRun(run({ studioReturnedResult: { status: StudioResultStatus.GoalNotAchievable, summary: "unreachable" } })).outcome,
    ).toBe(OutcomeClass.Fail);
  });

  it("account / credential reasons are errors, not studio fails", () => {
    const blocked = classifyRun(run({
      studioReturnedResult: {
        status: StudioResultStatus.Failure,
        structuredSummary: { failure: { reason: { text: "locked", type: RunFailureReasonType.AccountBlocked } } },
      },
    }));
    expect(blocked.outcome).toBe(OutcomeClass.Error);
    expect(blocked.bucket).toBe(FailureBucket.AccountLockout);

    const creds = classifyRun(run({
      studioReturnedResult: {
        status: StudioResultStatus.Failure,
        structuredSummary: { failure: { reason: { text: "bad creds", type: RunFailureReasonType.InvalidCredentials } } },
      },
    }));
    expect(creds.outcome).toBe(OutcomeClass.Error);
    expect(creds.bucket).toBe(FailureBucket.InvalidCredentials);
  });

  it("studio timeout is an error", () => {
    const v = classifyRun(run({ studioReturnedResult: { status: StudioResultStatus.Timeout } }));
    expect(v.outcome).toBe(OutcomeClass.Error);
    expect(v.bucket).toBe(FailureBucket.Timeout);
  });

  it("terminal workflow with no studio verdict is an untrustworthy error", () => {
    expect(classifyRun(run({ status: WorkflowRunStatus.Completed })).outcome).toBe(OutcomeClass.Error);
    expect(classifyRun(run({ status: WorkflowRunStatus.Failed })).outcome).toBe(OutcomeClass.Error);
    expect(classifyRun(run({ status: WorkflowRunStatus.Timeout })).bucket).toBe(FailureBucket.Timeout);
  });

  it("local timeout and null are errors", () => {
    expect(classifyRun(null, { localTimeout: true }).bucket).toBe(FailureBucket.Timeout);
    expect(classifyRun(null).outcome).toBe(OutcomeClass.Error);
  });
});

describe("passRate", () => {
  it("excludes errors from the denominator", () => {
    expect(passRate(3, 1)).toBe(0.75);
    expect(passRate(0, 0)).toBe(0);
  });
});

describe("summariseCase", () => {
  it("counts outcomes and tallies buckets", () => {
    const reps: RepResult[] = [
      { testCaseId: "tc", rep: 1, outcome: OutcomeClass.Pass, durationMs: 1 },
      { testCaseId: "tc", rep: 2, outcome: OutcomeClass.Fail, bucket: FailureBucket.ElementIndexDrift, durationMs: 1 },
      { testCaseId: "tc", rep: 3, outcome: OutcomeClass.Error, bucket: FailureBucket.AccountLockout, durationMs: 1 },
    ];
    const s = summariseCase("tc", "Title", reps);
    expect(s).toMatchObject({ reps: 3, passes: 1, fails: 1, errors: 1, passRate: 0.5 });
    expect(s.buckets[FailureBucket.ElementIndexDrift]).toBe(1);
    expect(s.buckets[FailureBucket.AccountLockout]).toBe(1);
  });
});
