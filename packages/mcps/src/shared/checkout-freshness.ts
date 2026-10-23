/**
 * Checkout freshness: is a checkout built on the latest base branch, and not on
 * another branch's unmerged work?
 *
 * `muggle checkout-freshness` runs this after fetching the base; the local E2E
 * tools run it on local refs before every run and refuse a stale checkout.
 */

import {
  BASE_REMOTE_NAME,
  BRANCH_CREATION_REFLOG_PREFIX,
  MAX_LISTED_INHERITED_COMMITS,
  SHORT_SHA_LENGTH,
} from "./checkout-freshness-constants.js";
import {
  CheckoutFreshnessVerdict,
  type GitCommandRunner,
  type ICheckoutFreshnessReport,
  type ICheckoutFreshnessRequest,
} from "./checkout-freshness-types.js";

export {
  BASE_REMOTE_NAME,
  BLOCKING_FRESHNESS_VERDICTS,
  BRANCH_CREATION_REFLOG_PREFIX,
  MAX_LISTED_INHERITED_COMMITS,
} from "./checkout-freshness-constants.js";
export {
  CheckoutFreshnessVerdict,
  type GitCommandRunner,
  type ICheckoutFreshnessReport,
  type ICheckoutFreshnessRequest,
} from "./checkout-freshness-types.js";
export { runGitCommand } from "./git-command-runner.js";

const shortSha = (sha: string): string => sha.slice(0, SHORT_SHA_LENGTH);

const pluralCommits = (count: number): string => (count === 1 ? "1 commit" : `${count} commits`);

const isAncestorAsync = async (
  runGit: GitCommandRunner,
  cwd: string,
  ancestorSha: string,
  descendantSha: string,
): Promise<boolean> => (await runGit(["merge-base", "--is-ancestor", ancestorSha, descendantSha], cwd)) !== null;

const resolveMainWorktreeRootAsync = async (runGit: GitCommandRunner, cwd: string): Promise<string | null> => {
  const porcelain = await runGit(["worktree", "list", "--porcelain"], cwd);
  const firstLine = porcelain?.split("\n")[0] ?? "";
  return firstLine.startsWith("worktree ") ? firstLine.slice("worktree ".length) : null;
};

const resolveDefaultBranchAsync = async (runGit: GitCommandRunner, cwd: string): Promise<string | null> => {
  const remoteHead = await runGit(["symbolic-ref", "--short", `refs/remotes/${BASE_REMOTE_NAME}/HEAD`], cwd);
  const prefix = `${BASE_REMOTE_NAME}/`;
  return remoteHead?.startsWith(prefix) ? remoteHead.slice(prefix.length) : null;
};

// A stacked change's base may exist only locally, so a local branch is the fallback.
const resolveBaseAsync = async (
  runGit: GitCommandRunner,
  cwd: string,
  baseBranch: string,
): Promise<{ ref: string; sha: string } | null> => {
  for (const ref of [`refs/remotes/${BASE_REMOTE_NAME}/${baseBranch}`, `refs/heads/${baseBranch}`]) {
    const sha = await runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    if (sha) return { ref: ref, sha: sha };
  }
  return null;
};

/** A full ref as people write it: `refs/remotes/origin/master` → `origin/master`. */
export const toDisplayRef = (ref: string): string => ref.replace(/^refs\/(remotes|heads)\//, "");

const isOwnRemoteBranch = (startPoint: string, branch: string): boolean =>
  startPoint === `${BASE_REMOTE_NAME}/${branch}` || startPoint === `refs/remotes/${BASE_REMOTE_NAME}/${branch}`;

/**
 * The commit a branch was created on and where it came from, from the oldest reflog entry.
 * Null when the reflog no longer records the creation, or when the branch was materialized
 * from its own remote copy — a PR branch, whose own commits are not someone else's.
 */
const readBranchCreationAsync = async (
  runGit: GitCommandRunner,
  cwd: string,
  branch: string,
): Promise<{ sha: string; startPoint: string } | null> => {
  const reflog = await runGit(["reflog", "show", "--format=%H%x09%gs", `refs/heads/${branch}`], cwd);
  const oldestEntry = reflog?.split("\n").at(-1) ?? "";
  const [sha, subject] = oldestEntry.split("\t");
  if (!sha || !subject?.startsWith(BRANCH_CREATION_REFLOG_PREFIX)) return null;
  const startPoint = subject.slice(BRANCH_CREATION_REFLOG_PREFIX.length);
  if (isOwnRemoteBranch(startPoint, branch)) return null;
  return { sha: sha, startPoint: startPoint };
};

const withVerdict = (
  report: ICheckoutFreshnessReport,
  verdict: CheckoutFreshnessVerdict,
  reason: string,
): ICheckoutFreshnessReport => ({ ...report, verdict: verdict, reason: reason });

/**
 * Check whether the checkout at `request.cwd` is built on the latest base branch.
 *
 * A branch counts as foreign-based only when its reflog still shows where it was created,
 * that start point is not its own remote copy, and the creation commit is still in HEAD's
 * history but not on the base — the unambiguous signature of a branch cut from another
 * branch's unmerged work. Anything less certain falls back to the ancestry check alone.
 *
 * @returns The verdict and the facts behind it; never throws.
 */
export async function evaluateCheckoutFreshness(request: ICheckoutFreshnessRequest): Promise<ICheckoutFreshnessReport> {
  const { cwd, runGit } = request;
  let report: ICheckoutFreshnessReport = {
    verdict: CheckoutFreshnessVerdict.NotApplicable,
    reason: "",
    checkoutRoot: null,
    mainWorktreeRoot: null,
    branch: null,
    headSha: null,
    baseRef: null,
    baseSha: null,
    behindBy: 0,
    creationSha: null,
    inheritedCommitCount: 0,
    inheritedCommits: [],
    hasFetchFailed: false,
  };

  const checkoutRoot = await runGit(["rev-parse", "--show-toplevel"], cwd);
  if (!checkoutRoot) return withVerdict(report, CheckoutFreshnessVerdict.NotApplicable, "not inside a git checkout");
  report.checkoutRoot = checkoutRoot;
  report.mainWorktreeRoot = await resolveMainWorktreeRootAsync(runGit, cwd);

  if ((await runGit(["remote", "get-url", BASE_REMOTE_NAME], cwd)) === null) {
    return withVerdict(report, CheckoutFreshnessVerdict.NotApplicable, `the checkout has no ${BASE_REMOTE_NAME} remote`);
  }
  const baseBranch = request.baseBranch ?? (await resolveDefaultBranchAsync(runGit, cwd));
  if (!baseBranch) {
    return withVerdict(
      report,
      CheckoutFreshnessVerdict.NotApplicable,
      `${BASE_REMOTE_NAME}'s default branch is unknown — name the base branch explicitly`,
    );
  }

  if (request.shouldFetchBase) {
    // An explicit refspec updates the remote-tracking ref even in a single-branch clone.
    const refspec = `+refs/heads/${baseBranch}:refs/remotes/${BASE_REMOTE_NAME}/${baseBranch}`;
    report.hasFetchFailed = (await runGit(["fetch", "--no-tags", BASE_REMOTE_NAME, refspec], cwd)) === null;
  }

  const base = await resolveBaseAsync(runGit, cwd, baseBranch);
  if (!base) {
    return withVerdict(
      report,
      CheckoutFreshnessVerdict.NotApplicable,
      `base branch ${baseBranch} exists neither on ${BASE_REMOTE_NAME} nor locally`,
    );
  }
  const headSha = await runGit(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], cwd);
  if (!headSha) return withVerdict(report, CheckoutFreshnessVerdict.NotApplicable, "the checkout has no commits");
  const baseName = toDisplayRef(base.ref);
  report = {
    ...report,
    baseRef: base.ref,
    baseSha: base.sha,
    headSha: headSha,
    branch: await runGit(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd),
  };

  if (!(await isAncestorAsync(runGit, cwd, base.sha, headSha))) {
    const behindCount = await runGit(["rev-list", "--count", `${headSha}..${base.sha}`], cwd);
    report.behindBy = Number(behindCount ?? "0");
  }

  const creation = report.branch ? await readBranchCreationAsync(runGit, cwd, report.branch) : null;
  if (creation) {
    report.creationSha = creation.sha;
    const isCreatedOnBase = await isAncestorAsync(runGit, cwd, creation.sha, base.sha);
    const isCreationStillCarried = !isCreatedOnBase && (await isAncestorAsync(runGit, cwd, creation.sha, headSha));
    if (isCreationStillCarried) {
      const inheritedRange = `${base.sha}..${creation.sha}`;
      report.inheritedCommitCount = Number((await runGit(["rev-list", "--count", inheritedRange], cwd)) ?? "0");
      const inheritedLog = await runGit(
        ["log", "--format=%h %s", `-n${MAX_LISTED_INHERITED_COMMITS}`, inheritedRange],
        cwd,
      );
      report.inheritedCommits = inheritedLog ? inheritedLog.split("\n") : [];
      return withVerdict(
        report,
        CheckoutFreshnessVerdict.ForeignBase,
        `${report.branch} was created from ${creation.startPoint} at ${shortSha(creation.sha)}, which ${baseName} ` +
          `does not contain — it carries ${pluralCommits(report.inheritedCommitCount)} from that branch`,
      );
    }
  }

  if (report.behindBy > 0) {
    return withVerdict(
      report,
      CheckoutFreshnessVerdict.BehindBase,
      `HEAD is ${pluralCommits(report.behindBy)} behind ${baseName} (${shortSha(base.sha)})`,
    );
  }
  return withVerdict(report, CheckoutFreshnessVerdict.Fresh, `HEAD contains ${baseName} (${shortSha(base.sha)})`);
}
