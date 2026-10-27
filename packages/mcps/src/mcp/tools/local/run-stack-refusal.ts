/** Tool-result text the local execute tools return when the shared service stack does not serve the caller's code. */

import { StackCheckVerdict, type IStackCheckReport } from "../../../shared/service-stack/service-stack-types.js";
import { describeStackMismatch } from "../../../shared/service-stack/stack-mismatch-description.js";

/** Tool-result text for a run refused by the stack check: what holds the port and how to get it. */
export function formatRunStackRefusal(report: IStackCheckReport, cwd: string): string {
  const mismatchLines = report.mismatches.map((mismatch) => `- ${describeStackMismatch(mismatch)}`);
  const remedy =
    report.verdict === StackCheckVerdict.PeerLease
      ? `Claim the stack for this checkout — \`muggle stack claim --cwd "${cwd}" --need <port>=<run-dir>\` — then wait your turn or re-run prepare once it is granted.`
      : `Re-run muggle-test-prepare from this checkout: it re-claims the stack and restarts what moved.`;
  return [
    report.verdict === StackCheckVerdict.PeerLease
      ? "## Run refused — the target port is leased to another checkout"
      : "## Run refused — the service stack changed since this checkout claimed it",
    "",
    `**Verdict:** ${report.verdict}`,
    `**Checkout:** ${report.cwd}`,
    `**Why:** ${report.reason}`,
    ...(mismatchLines.length > 0 ? ["", ...mismatchLines] : []),
    "",
    "Nothing was launched, and this is not a test result.",
    remedy,
  ].join("\n");
}

/** Note appended to a run's result when the stack moved while it ran. */
export function formatStackChangedDuringRun(report: IStackCheckReport): string {
  const ports = report.mismatches.map((mismatch) => mismatch.need.port).join(", ");
  return [
    "",
    `**Warning:** the service stack changed during this run (port ${ports} no longer serves the claimed code). ` +
      "This result may describe code that is not this checkout's — re-run prepare and run it again before trusting it.",
  ].join("\n");
}
