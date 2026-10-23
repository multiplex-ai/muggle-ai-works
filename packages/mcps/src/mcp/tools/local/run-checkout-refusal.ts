/** Tool-result text the local execute tools return when the checkout gate refuses a run. */

import {
  CheckoutFreshnessVerdict,
  toDisplayRef,
  type ICheckoutFreshnessReport,
} from "../../../shared/checkout-freshness.js";

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
