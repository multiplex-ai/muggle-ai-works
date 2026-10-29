import { describe, it, expect } from "vitest";

import { verifyBaselineFailures } from "../../../cli/pr-section/baseline";
import type { E2eReport, FailedTest, IBaselineRunRecord, IBaselineVerificationDeps, TestResult } from "../../../cli/pr-section/types";

const MERGE_BASE = "1".repeat(40);
const BASE_SERVED = "2".repeat(40);
const BASE_TIP = "3".repeat(40);
const BEFORE_FORK = "0".repeat(40);
const PR_HEAD = "4".repeat(40);

// Base history: BEFORE_FORK → MERGE_BASE → BASE_SERVED → BASE_TIP; the PR branches off at MERGE_BASE.
const BASE_ORDER = [BEFORE_FORK, MERGE_BASE, BASE_SERVED, BASE_TIP];

function fakeGit(calls: string[][]): IBaselineVerificationDeps["runGit"] {
  return async (args) => {
    calls.push(args);
    if (args[0] === "symbolic-ref") return "refs/remotes/origin/master";
    if (args[0] === "rev-parse") return args[2].startsWith("refs/remotes/origin/") ? BASE_TIP : null;
    if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
      const ancestorAt = BASE_ORDER.indexOf(args[2]);
      const descendantAt = BASE_ORDER.indexOf(args[3]);
      return ancestorAt !== -1 && descendantAt !== -1 && ancestorAt <= descendantAt ? "" : null;
    }
    if (args[0] === "merge-base") return MERGE_BASE;
    return null;
  };
}

const failed: FailedTest = {
  name: "Checkout",
  testCaseId: "tc-2",
  runId: "pr-run",
  viewUrl: "https://www.muggle-ai.com/run/pr",
  status: "failed",
  steps: [],
  failureStepIndex: 0,
  error: "Pay button disabled",
  baselineRunId: "base-run",
};

const passed: TestResult = {
  name: "Login",
  testCaseId: "tc-1",
  runId: "run-1",
  viewUrl: "https://www.muggle-ai.com/run/1",
  status: "passed",
  steps: [],
};

const baselineRun: IBaselineRunRecord = {
  id: "base-run",
  status: "failed",
  cloudTestCaseId: "tc-2",
  viewUrl: "https://www.muggle-ai.com/run/base",
  localExecutionContext: { servedStack: [{ headSha: BASE_SERVED }] },
};

async function verify(tests: TestResult[], runs: IBaselineRunRecord[] = [baselineRun], baseBranch?: string) {
  const gitCalls: string[][] = [];
  const stderr: string[] = [];
  const report: E2eReport = { projectId: "p-1", tests: tests };
  const verified = await verifyBaselineFailures(report, {
    cwd: "/repo",
    baseBranch: baseBranch,
    runGit: fakeGit(gitCalls),
    readRunResult: (runId) => runs.find((run) => run.id === runId),
    stderrWrite: (text) => {
      stderr.push(text);
      return true;
    },
  });
  return { tests: verified.tests, stderr: stderr, gitCalls: gitCalls };
}

const failsOnBaseOf = (test: TestResult | undefined) => (test?.status === "failed" ? test.failsOnBase : undefined);

describe("verifyBaselineFailures", () => {
  it("credits a failure whose baseline failed the same case on a base commit since the fork", async () => {
    const { tests, stderr } = await verify([passed, failed]);
    expect(failsOnBaseOf(tests[1])).toEqual({
      baselineRunId: "base-run",
      baselineSha: BASE_SERVED,
      viewUrl: "https://www.muggle-ai.com/run/base",
    });
    expect(tests[0]).toBe(passed);
    expect(stderr).toEqual([]);
  });

  it("accepts the fork point and the base tip themselves as served commits", async () => {
    for (const servedSha of [MERGE_BASE, BASE_TIP]) {
      const run = { ...baselineRun, localExecutionContext: { servedStack: [{ headSha: servedSha }] } };
      expect(failsOnBaseOf((await verify([failed], [run])).tests[0])?.baselineSha).toBe(servedSha);
    }
  });

  it("refuses a baseline that served a commit before the fork, on the PR branch, or from another repo", async () => {
    for (const servedSha of [BEFORE_FORK, PR_HEAD, "f".repeat(40)]) {
      const run = { ...baselineRun, localExecutionContext: { servedStack: [{ headSha: servedSha }] } };
      const { tests, stderr } = await verify([failed], [run]);
      expect(failsOnBaseOf(tests[0])).toBeUndefined();
      expect(stderr[0]).toContain(`none of the commits it served is on the base between 1111111..3333333`);
    }
  });

  it("credits a wave baseline through whichever served commit belongs to this repo", async () => {
    const run = { ...baselineRun, localExecutionContext: { servedStack: [{ headSha: "f".repeat(40) }, { headSha: BASE_SERVED }] } };
    expect(failsOnBaseOf((await verify([failed], [run])).tests[0])?.baselineSha).toBe(BASE_SERVED);
  });

  it("names why each unusable citation is refused, leaving the failure uncredited", async () => {
    const cases: Array<[FailedTest, IBaselineRunRecord[], string]> = [
      [failed, [], "no such run in the local run store"],
      [{ ...failed, runId: "base-run" }, [baselineRun], "it is the failing run itself"],
      [failed, [{ ...baselineRun, cloudTestCaseId: "tc-9" }], "it ran test case tc-9"],
      [failed, [{ ...baselineRun, status: "passed" }], "its status is passed"],
      [{ ...failed, runSettingsId: "rs-390" }, [{ ...baselineRun, cloudRunSettingsId: "rs-1280" }], "it ran under a different runSettings record"],
      [failed, [{ ...baselineRun, localExecutionContext: {} }], "it recorded no stack it served"],
      [failed, [{ ...baselineRun, localExecutionContext: { servedStack: [{ headSha: "--upload-pack=x" }] } }], "it recorded no stack it served"],
    ];
    for (const [test, runs, reason] of cases) {
      const { tests, stderr } = await verify([test], runs);
      expect(failsOnBaseOf(tests[0])).toBeUndefined();
      expect(stderr).toEqual([`build-pr-section: baseline base-run for "Checkout" not credited: ${reason}\n`]);
    }
  });

  it("strips a failsOnBase the input carried, and runs no git when nothing cites a baseline", async () => {
    const forged: FailedTest = { ...failed, baselineRunId: undefined, failsOnBase: { baselineRunId: "x", baselineSha: BASE_SERVED } };
    const { tests, gitCalls } = await verify([forged]);
    expect(tests[0]).not.toHaveProperty("failsOnBase");
    expect(gitCalls).toEqual([]);
  });

  it("resolves the base once for the whole report, from the named branch when given", async () => {
    const second: FailedTest = { ...failed, name: "Refund", testCaseId: "tc-5", baselineRunId: "base-run-2" };
    const runs = [baselineRun, { ...baselineRun, id: "base-run-2", cloudTestCaseId: "tc-5" }];
    const { tests, gitCalls } = await verify([failed, second], runs, "release");
    expect(tests.map(failsOnBaseOf).map((credit) => credit?.baselineRunId)).toEqual(["base-run", "base-run-2"]);
    expect(gitCalls.filter((args) => args[0] === "rev-parse")).toEqual([["rev-parse", "--verify", "refs/remotes/origin/release^{commit}"]]);
    expect(gitCalls.some((args) => args[0] === "symbolic-ref")).toBe(false);
  });

  it("credits nothing when the base cannot be resolved", async () => {
    const report: E2eReport = { projectId: "p-1", tests: [failed] };
    const stderr: string[] = [];
    const verified = await verifyBaselineFailures(report, {
      cwd: "/repo",
      runGit: async () => null,
      readRunResult: () => baselineRun,
      stderrWrite: (text) => stderr.push(text) > 0,
    });
    expect(failsOnBaseOf(verified.tests[0])).toBeUndefined();
    expect(stderr[0]).toContain("the base branch could not be resolved in this checkout");
  });
});
