import { StudioVerdict } from "../../local/types/enums.js";
import { STUDIO_VERDICT_LABELS } from "./studio-verdict-line-constants.js";

function isStudioVerdict(rawStatus: string): rawStatus is StudioVerdict {
  return (Object.values(StudioVerdict) as string[]).includes(rawStatus);
}

/**
 * Format a run's `**Studio Verdict:**` report line from the result the Studio returned.
 *
 * @param studioReturnedResult - The stored run's `studioReturnedResult`, of any shape.
 * @returns The report line, or an empty string when the result carries no verdict.
 *
 * Output shape: `**Studio Verdict:** Bug Detected (bug_detected)`
 */
export function formatStudioVerdictLine(studioReturnedResult: unknown): string {
  if (typeof studioReturnedResult !== "object" || studioReturnedResult === null) {
    return "";
  }
  const rawStatus = (studioReturnedResult as Record<string, unknown>).status;
  if (typeof rawStatus !== "string" || rawStatus.length === 0) {
    return "";
  }
  // A verdict from a newer Studio is still shown, verbatim, rather than dropped.
  const verdictText = isStudioVerdict(rawStatus) ? `${STUDIO_VERDICT_LABELS[rawStatus]} (${rawStatus})` : rawStatus;
  return `**Studio Verdict:** ${verdictText}`;
}
