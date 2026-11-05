import { StudioVerdict } from "../../local/types/enums.js";
import type { RunResultStatus } from "../../local/types/run-result-storage-types.js";
import { RECORDED_SCRIPT_LIFECYCLE_STATUS, STUDIO_VERDICT_LABELS } from "./studio-verdict-line-constants.js";

function isStudioVerdict(rawStatus: string): rawStatus is StudioVerdict {
  return (Object.values(StudioVerdict) as string[]).includes(rawStatus);
}

function readNonEmptyString(candidate: unknown): string | undefined {
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function resolveVerdictStatus(studioReturnedResult: Record<string, unknown>): string | undefined {
  const reportedStatus = readNonEmptyString(studioReturnedResult.status);
  if (reportedStatus !== undefined && reportedStatus !== RECORDED_SCRIPT_LIFECYCLE_STATUS) {
    return reportedStatus;
  }
  // A run stored before generation kept the studio's verdict, or one that published nothing, has
  // only its summary's verdict left.
  const summaryStep = studioReturnedResult.summaryStep as { structuredSummary?: { status?: unknown } } | undefined;
  return readNonEmptyString(summaryStep?.structuredSummary?.status);
}

/**
 * Format a run's `**Studio Verdict:**` report line from the result the Studio returned.
 *
 * @param params.studioReturnedResult - The stored run's `studioReturnedResult`, of any shape.
 * @param params.runStatus - The stored run's status; a run that did not pass never reads as passed.
 * @returns The report line, or an empty string when the result carries no verdict the run can stand behind.
 *
 * Output shape: `**Studio Verdict:** Bug Detected (bug_detected)`
 */
export function formatStudioVerdictLine(params: { studioReturnedResult: unknown; runStatus: RunResultStatus }): string {
  const { studioReturnedResult, runStatus } = params;
  if (typeof studioReturnedResult !== "object" || studioReturnedResult === null) {
    return "";
  }
  const verdictStatus = resolveVerdictStatus(studioReturnedResult as Record<string, unknown>);
  if (verdictStatus === undefined) {
    return "";
  }
  // The summary can read as a success on a run that then failed to publish.
  if (verdictStatus === StudioVerdict.Success && runStatus !== "passed") {
    return "";
  }
  // A verdict from a newer Studio is still shown, verbatim, rather than dropped.
  const verdictText = isStudioVerdict(verdictStatus)
    ? `${STUDIO_VERDICT_LABELS[verdictStatus]} (${verdictStatus})`
    : verdictStatus;
  return `**Studio Verdict:** ${verdictText}`;
}
