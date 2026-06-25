import { describe, expect, it } from "vitest";

import { buildReport, renderMarkdown } from "./report.js";
import {
  type BatchConfig,
  FailureBucket,
  type GoldenSet,
  OutcomeClass,
  type RepResult,
} from "./types.js";

const golden: GoldenSet = {
  sourceProjectId: "proj-1",
  importedAt: "t",
  cases: [
    { testCaseId: "tc-1", useCaseId: "uc", projectId: "proj-1", title: "Login", url: "", goal: "", precondition: "", instructions: "", expectedResult: "", bodyHash: "h1" },
    { testCaseId: "tc-2", useCaseId: "uc", projectId: "proj-1", title: "Checkout", url: "", goal: "", precondition: "", instructions: "", expectedResult: "", bodyHash: "h2" },
  ],
};

const config: BatchConfig = { runs: 2, concurrency: 2, repTimeoutMs: 1000, flags: { memory: "v1" }, dryRun: false };

const reps: RepResult[] = [
  { testCaseId: "tc-1", rep: 1, outcome: OutcomeClass.Pass, durationMs: 1 },
  { testCaseId: "tc-1", rep: 2, outcome: OutcomeClass.Pass, durationMs: 1 },
  { testCaseId: "tc-2", rep: 1, outcome: OutcomeClass.Fail, bucket: FailureBucket.ElementIndexDrift, durationMs: 1 },
  { testCaseId: "tc-2", rep: 2, outcome: OutcomeClass.Error, bucket: FailureBucket.AccountLockout, durationMs: 1 },
];

describe("buildReport", () => {
  const report = buildReport("batch-1", golden, config, reps);

  it("computes overall pass-rate excluding infra errors", () => {
    // 2 pass, 1 fail, 1 error -> 2 / (2+1) = 0.666...
    expect(report.overallPassRate).toBeCloseTo(2 / 3, 5);
    expect(report.scoredReps).toBe(3);
    expect(report.infraErrors).toBe(1);
  });

  it("tallies buckets and carries the flags", () => {
    expect(report.buckets[FailureBucket.ElementIndexDrift]).toBe(1);
    expect(report.buckets[FailureBucket.AccountLockout]).toBe(1);
    expect(report.flags).toEqual({ memory: "v1" });
  });

  it("orders cases worst pass-rate first", () => {
    expect(report.cases.map((c) => c.testCaseId)).toEqual(["tc-2", "tc-1"]);
  });
});

describe("renderMarkdown", () => {
  it("includes the headline pass-rate, bucket rollup, and per-case rows", () => {
    const md = renderMarkdown(buildReport("batch-1", golden, config, reps));
    expect(md).toContain("Overall pass-rate: 66.7%");
    expect(md).toContain(FailureBucket.ElementIndexDrift);
    expect(md).toContain("Checkout");
    expect(md).toContain("Login");
  });
});
