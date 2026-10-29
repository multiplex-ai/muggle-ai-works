import { SHORT_SHA_LENGTH } from "../../pr-walkthrough/constants.js";
import { BASELINE_FAILED_STATUS, FULL_COMMIT_SHA_PATTERN } from "./constants.js";
import type {
  BaselineJudgment,
  E2eReport,
  FailedTest,
  IBaselineRunRecord,
  IBaselineVerificationDeps,
  IBaseRange,
  TestResult,
} from "./types.js";

const refused = (refusalReason: string): BaselineJudgment => ({ isCredited: false, refusalReason: refusalReason });

async function resolveBaseRange(deps: IBaselineVerificationDeps): Promise<IBaseRange | null> {
  const baseRef = deps.baseBranch
    ? `refs/remotes/origin/${deps.baseBranch}`
    : await deps.runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], deps.cwd);
  if (!baseRef) return null;
  const baseTipSha = await deps.runGit(["rev-parse", "--verify", `${baseRef}^{commit}`], deps.cwd);
  if (!baseTipSha) return null;
  const mergeBaseSha = await deps.runGit(["merge-base", "HEAD", baseTipSha], deps.cwd);
  return mergeBaseSha ? { mergeBaseSha: mergeBaseSha, baseTipSha: baseTipSha } : null;
}

// A commit from another repo, a later PR branch, or a base from before this PR
// forked fails one of the two ancestry checks.
async function isOnBaseSinceFork(sha: string, range: IBaseRange, deps: IBaselineVerificationDeps): Promise<boolean> {
  const isAncestor = async (ancestor: string, descendant: string): Promise<boolean> =>
    (await deps.runGit(["merge-base", "--is-ancestor", ancestor, descendant], deps.cwd)) !== null;
  return (await isAncestor(range.mergeBaseSha, sha)) && (await isAncestor(sha, range.baseTipSha));
}

function servedCommitsOf(baselineRun: IBaselineRunRecord): string[] {
  const servedStack = baselineRun.localExecutionContext?.servedStack;
  if (!Array.isArray(servedStack)) return [];
  return servedStack
    .map((servedNeed) => servedNeed?.headSha)
    .filter((sha): sha is string => typeof sha === "string" && FULL_COMMIT_SHA_PATTERN.test(sha));
}

async function judgeBaseline(
  test: FailedTest,
  baselineRunId: string,
  range: IBaseRange | null,
  deps: IBaselineVerificationDeps,
): Promise<BaselineJudgment> {
  if (range === null) return refused("the base branch could not be resolved in this checkout");
  const baselineRun = deps.readRunResult(baselineRunId);
  if (!baselineRun) return refused("no such run in the local run store");
  if (baselineRun.id === test.runId) return refused("it is the failing run itself");
  if (baselineRun.cloudTestCaseId !== test.testCaseId) return refused(`it ran test case ${baselineRun.cloudTestCaseId}`);
  if (baselineRun.status !== BASELINE_FAILED_STATUS) return refused(`its status is ${baselineRun.status}`);
  if (test.runSettingsId && baselineRun.cloudRunSettingsId && baselineRun.cloudRunSettingsId !== test.runSettingsId) {
    return refused("it ran under a different runSettings record");
  }
  const servedCommits = servedCommitsOf(baselineRun);
  if (servedCommits.length === 0) return refused("it recorded no stack it served");
  for (const servedSha of servedCommits) {
    if (!(await isOnBaseSinceFork(servedSha, range, deps))) continue;
    return {
      isCredited: true,
      failsOnBase: {
        baselineRunId: baselineRun.id,
        baselineSha: servedSha,
        ...(baselineRun.viewUrl && { viewUrl: baselineRun.viewUrl }),
      },
    };
  }
  const span = `${range.mergeBaseSha.slice(0, SHORT_SHA_LENGTH)}..${range.baseTipSha.slice(0, SHORT_SHA_LENGTH)}`;
  return refused(`none of the commits it served is on the base between ${span}`);
}

function withoutFailsOnBase(test: FailedTest): FailedTest {
  const uncredited: FailedTest = { ...test };
  delete uncredited.failsOnBase;
  return uncredited;
}

/**
 * The report with `failsOnBase` set on exactly the failures whose cited
 * `baselineRunId` verifies: a run of the same test case that failed while the
 * stack served a commit on the base, between the PR's fork point and the base
 * tip. Every other failure is left uncredited, whatever the input carried, and
 * each refused citation is named on stderr. Git runs only when a failure cites
 * a baseline.
 */
export async function verifyBaselineFailures(report: E2eReport, deps: IBaselineVerificationDeps): Promise<E2eReport> {
  let range: IBaseRange | null | undefined;
  const tests: TestResult[] = [];
  for (const test of report.tests) {
    if (test.status !== "failed") {
      tests.push(test);
      continue;
    }
    const uncredited = withoutFailsOnBase(test);
    if (!test.baselineRunId) {
      tests.push(uncredited);
      continue;
    }
    if (range === undefined) range = await resolveBaseRange(deps);
    const judgment = await judgeBaseline(uncredited, test.baselineRunId, range, deps);
    if (judgment.isCredited) {
      tests.push({ ...uncredited, failsOnBase: judgment.failsOnBase });
      continue;
    }
    deps.stderrWrite(`build-pr-section: baseline ${test.baselineRunId} for "${test.name}" not credited: ${judgment.refusalReason}\n`);
    tests.push(uncredited);
  }
  return { ...report, tests: tests };
}
