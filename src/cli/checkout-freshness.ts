/**
 * `muggle checkout-freshness` CLI handler.
 *
 * Fetches the base branch and reports whether the checkout is built on its latest
 * commit. Skills run it before starting dev servers or E2E; the local execute tools
 * name it when they refuse a stale checkout.
 */

import {
  BLOCKING_FRESHNESS_VERDICTS,
  evaluateCheckoutFreshness,
  runGitCommand,
  type ICheckoutFreshnessReport,
} from "@muggleai/mcp";
import type { CheckoutFreshnessFlags } from "./checkout-freshness-types.js";

/** Human-readable summary of a report, one fact per line. */
export function renderCheckoutFreshnessSummary(report: ICheckoutFreshnessReport): string {
  const lines = [`${report.verdict}: ${report.reason}`];
  if (report.checkoutRoot) lines.push(`checkout: ${report.checkoutRoot}`);
  if (report.headSha) lines.push(`head: ${report.headSha}${report.branch ? ` (${report.branch})` : " (detached)"}`);
  if (report.baseRef && report.baseSha) lines.push(`base: ${report.baseRef} @ ${report.baseSha}`);
  if (report.hasFetchFailed) lines.push("warning: fetching the base failed — checked against the last fetched base");
  for (const commit of report.inheritedCommits) lines.push(`inherited: ${commit}`);
  return lines.join("\n");
}

/**
 * Check the checkout and print the verdict.
 *
 * Exits 1 on `BEHIND_BASE` or `FOREIGN_BASE`, so a script can gate on it; `FRESH` and
 * `NOT_APPLICABLE` exit 0.
 *
 * @param flags - `--cwd`, `--base`, `--no-fetch`, `--json`.
 */
export async function checkoutFreshnessCommand(flags: CheckoutFreshnessFlags): Promise<void> {
  const report = await evaluateCheckoutFreshness({
    cwd: flags.cwd ?? process.cwd(),
    baseBranch: flags.base,
    shouldFetchBase: flags.fetch !== false,
    runGit: runGitCommand,
  });
  const output = flags.json ? JSON.stringify(report, null, 2) : renderCheckoutFreshnessSummary(report);
  process.stdout.write(`${output}\n`);
  if (BLOCKING_FRESHNESS_VERDICTS.has(report.verdict)) process.exitCode = 1;
}
