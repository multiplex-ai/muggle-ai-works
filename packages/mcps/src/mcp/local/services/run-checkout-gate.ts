/**
 * Refuses a local E2E run whose checkout is not built on the latest base it knows of.
 *
 * Reads local refs only: every worktree of a clone shares `refs/remotes`, so any
 * session's fetch keeps them current, and a run never waits on the network. Only
 * loopback targets are guarded — there the app under test is served from a checkout
 * on this machine, and `cwd` names it.
 */

import {
  BLOCKING_FRESHNESS_VERDICTS,
  CheckoutFreshnessVerdict,
  evaluateCheckoutFreshness,
  runGitCommand,
  toDisplayRef,
  type GitCommandRunner,
  type ICheckoutFreshnessReport,
} from "../../../shared/checkout-freshness.js";
import {
  IPV4_LOOPBACK_PREFIX,
  LOCALHOST_DOMAIN_SUFFIX,
  LOOPBACK_HOSTNAMES,
} from "./run-checkout-gate-constants.js";

/** True when `url` targets this machine. */
export function isLoopbackUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    LOOPBACK_HOSTNAMES.includes(hostname) ||
    hostname.startsWith(IPV4_LOOPBACK_PREFIX) ||
    hostname.endsWith(LOCALHOST_DOMAIN_SUFFIX)
  );
}

/**
 * The freshness report that refuses this run, or null when the run may proceed.
 *
 * @param params.cwd - The caller's checkout, as passed to the execute tool.
 * @param params.localUrl - The run target; only loopback targets are checked.
 * @param params.baseBranch - Base of a stacked change; the remote's default branch when omitted.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 */
export async function findRunCheckoutRefusal(params: {
  cwd: string;
  localUrl: string;
  baseBranch?: string;
  runGit?: GitCommandRunner;
}): Promise<ICheckoutFreshnessReport | null> {
  if (!isLoopbackUrl(params.localUrl)) return null;
  const report = await evaluateCheckoutFreshness({
    cwd: params.cwd,
    baseBranch: params.baseBranch,
    shouldFetchBase: false,
    runGit: params.runGit ?? runGitCommand,
  });
  return BLOCKING_FRESHNESS_VERDICTS.has(report.verdict) ? report : null;
}

/** Tool-result text for a refused run: what is wrong and the commands that clear it. */
export function formatRunCheckoutRefusal(report: ICheckoutFreshnessReport, cwd: string): string {
  const baseName = report.baseRef ? toDisplayRef(report.baseRef) : "";
  const remedy =
    report.verdict === CheckoutFreshnessVerdict.ForeignBase
      ? `Recreate the branch from \`${baseName}\` and carry over only this change's own commits — or, when the change deliberately stacks on that branch, pass it as \`baseBranch\`.`
      : `Rebase this checkout onto \`${baseName}\`.`;
  const inherited =
    report.inheritedCommits.length > 0
      ? ["", "Inherited commits:", ...report.inheritedCommits.map((commit) => `- ${commit}`)]
      : [];
  return [
    `## Run refused — checkout is not on the latest ${baseName || "base"}`,
    "",
    `**Verdict:** ${report.verdict}`,
    `**Checkout:** ${report.checkoutRoot ?? cwd}`,
    `**Why:** ${report.reason}`,
    ...inherited,
    "",
    "Nothing was launched. To clear it:",
    `1. \`muggle checkout-freshness --cwd "${cwd}"\` — fetches the base and re-checks.`,
    `2. ${remedy}`,
    "3. Restart the dev server from this checkout, then run again.",
  ].join("\n");
}
