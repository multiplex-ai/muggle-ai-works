import { describe, expect, it, vi } from "vitest";

import { planTasks, runBatch } from "./orchestrator.js";
import {
  type BackendClient,
  type BatchConfig,
  FailureBucket,
  type GoldenCase,
  type GoldenSet,
  OutcomeClass,
  StudioResultStatus,
  WorkflowRunStatus,
} from "./types.js";

function gcase (id: string): GoldenCase {
  return {
    testCaseId: id,
    useCaseId: "uc",
    projectId: "proj",
    title: id,
    url: "https://app",
    goal: "g",
    precondition: "p",
    instructions: "i",
    expectedResult: "e",
    bodyHash: "h",
  };
}

function mockClient (over: Partial<BackendClient> = {}): BackendClient {
  return {
    listProjects: async () => [],
    listTestCasesByProject: async () => [],
    getTestCase: async (id) => ({ id: id }),
    startGeneration: async () => ({ runtimeId: "rt" }),
    getLatestRun: async () => ({
      id: "run",
      status: WorkflowRunStatus.Completed,
      studioReturnedResult: { status: StudioResultStatus.Success },
    }),
    cancelRuntime: async () => undefined,
    ...over,
  };
}

const golden: GoldenSet = { sourceProjectId: "proj", importedAt: "t", cases: [gcase("tc-1")] };
const config = (over: Partial<BatchConfig> = {}): BatchConfig => ({
  runs: 2,
  concurrency: 1,
  repTimeoutMs: 1000,
  flags: {},
  dryRun: false,
  ...over,
});

describe("planTasks", () => {
  it("expands cases × runs and honours the case filter and skip", () => {
    const two: GoldenSet = { ...golden, cases: [gcase("tc-1"), gcase("tc-2")] };
    expect(planTasks(two, config({ runs: 3 }))).toHaveLength(6);
    expect(planTasks(two, config({ runs: 3, caseFilter: ["tc-2"] }))).toHaveLength(3);
    expect(planTasks(two, config({ runs: 2 }), { skip: (_id, rep) => rep === 1 })).toHaveLength(2);
  });
});

describe("runBatch", () => {
  it("records a pass per rep on a terminal success and fires onRepDone", async () => {
    const onRepDone = vi.fn();
    const reps = await runBatch(mockClient(), golden, config(), { onRepDone: onRepDone });
    expect(reps).toHaveLength(2);
    expect(reps.every((r) => r.outcome === OutcomeClass.Pass)).toBe(true);
    expect(onRepDone).toHaveBeenCalledTimes(2);
  });

  it("times out, cancels the runtime, and records an infra error", async () => {
    const cancelRuntime = vi.fn(async () => undefined);
    const client = mockClient({
      getLatestRun: async () => ({ id: "run", status: WorkflowRunStatus.Running }),
      cancelRuntime: cancelRuntime,
    });
    const reps = await runBatch(client, golden, config({ runs: 1, repTimeoutMs: 0 }));
    expect(reps[0].outcome).toBe(OutcomeClass.Error);
    expect(reps[0].bucket).toBe(FailureBucket.Timeout);
    expect(cancelRuntime).toHaveBeenCalledOnce();
  });

  it("classifies a transport error as an infra error and keeps the pass-rate clean", async () => {
    const client = mockClient({
      startGeneration: async () => { throw new Error("POST ... -> 429: Too Many Requests"); },
    });
    const reps = await runBatch(client, golden, config({ runs: 1 }));
    expect(reps[0].outcome).toBe(OutcomeClass.Error);
    expect(reps[0].bucket).toBe(FailureBucket.AccountLockout);
  });

  it("skips reps already done (resume)", async () => {
    const reps = await runBatch(mockClient(), golden, config({ runs: 2 }), { skip: (_id, rep) => rep === 1 });
    expect(reps).toHaveLength(1);
    expect(reps[0].rep).toBe(2);
  });
});
