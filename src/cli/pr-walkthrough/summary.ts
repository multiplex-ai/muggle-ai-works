import { renderUnpassedCaseBullet } from "../../e2e-result/format.js";
import { UnpassedCaseStatus, type IE2eResultRecord } from "../../e2e-result/types.js";
import { CHECK_SUMMARY_MAX_CASES } from "./constants.js";

function countLabel(count: number, status: UnpassedCaseStatus): string | null {
  return count > 0 ? `${count} ${status}` : null;
}

/**
 * Check-run summary for a walkthrough that did not pass: the tally, what to do,
 * and one line per failed or inconclusive case — so the failing check alone says
 * what broke, for a reviewer and for the watcher that repairs it.
 *
 * Output shape:
 * ```
 * E2E acceptance did not pass — 1 failed, 1 inconclusive of 3 test cases. …
 *
 * - ❌ **Checkout** — failed at step 4: Pay button disabled · [open run](https://…)
 * ```
 */
export function renderNotPassingSummary(record: IE2eResultRecord): string {
  const failed = record.unpassed.filter((c) => c.status === UnpassedCaseStatus.Failed).length;
  const tally = [
    countLabel(failed, UnpassedCaseStatus.Failed),
    countLabel(record.unpassed.length - failed, UnpassedCaseStatus.Inconclusive),
  ].filter((part): part is string => part !== null).join(", ");
  const listed = record.unpassed
    .slice(0, CHECK_SUMMARY_MAX_CASES)
    .map((unpassed) => renderUnpassedCaseBullet(unpassed, "open run", unpassed.viewUrl));
  const hidden = record.unpassed.length - listed.length;
  return [
    `E2E acceptance did not pass — ${tally} of ${record.total} test ${record.total === 1 ? "case" : "cases"}. ` +
      "Fix them, re-run the whole suite, and update the walkthrough comment; editing it re-runs this check.",
    "",
    ...listed,
    ...(hidden > 0 ? [`- …and ${hidden} more — see the walkthrough comment.`] : []),
  ].join("\n");
}
