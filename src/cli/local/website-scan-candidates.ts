import { localQa } from "@muggleai/mcp";

import {
  DEFAULT_LOCAL_SCAN_MAX_CANDIDATES,
  DROPPED_CANDIDATE_STATUS,
  SIGNED_IN_FLOW_PATTERN,
} from "./local-scan-constants.js";
import { LocalScanStatusEnum } from "./local-scan-types.js";
import type {
  IDiscoveredUseCase,
  IDiscoveryMemory,
  IDiscoveryMemoryCandidate,
  ILocalScanCandidate,
  ILocalScanLimits,
} from "./local-scan-types.js";

/**
 * Parse `--max-candidates` and `--timeout-ms`.
 * @throws Error when either is given but is not a positive integer.
 */
export function parseLocalScanLimits(params: {
  maxCandidatesOption: string | undefined;
  timeoutMsOption: string | undefined;
  defaultTimeoutMs: number;
}): ILocalScanLimits {
  return {
    maxCandidates: parsePositiveInteger({
      optionName: "--max-candidates",
      optionValue: params.maxCandidatesOption,
      defaultValue: DEFAULT_LOCAL_SCAN_MAX_CANDIDATES,
    }),
    timeoutMs: parsePositiveInteger({
      optionName: "--timeout-ms",
      optionValue: params.timeoutMsOption,
      defaultValue: params.defaultTimeoutMs,
    }),
  };
}

function parsePositiveInteger(params: { optionName: string; optionValue: string | undefined; defaultValue: number }): number {
  if (params.optionValue === undefined) {
    return params.defaultValue;
  }
  const parsedValue = Number(params.optionValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`${params.optionName} must be a positive integer, got "${params.optionValue}".`);
  }
  return parsedValue;
}

/** Whether a candidate's text says its flow runs signed in. */
export function isSignedInFlow(useCase: IDiscoveredUseCase): boolean {
  const searchableText = [
    useCase.title,
    useCase.description,
    useCase.userStory,
    JSON.stringify(useCase.useCaseBreakdown ?? []),
  ].join("\n");
  return SIGNED_IN_FLOW_PATTERN.test(searchableText);
}

/**
 * Candidates the scan added to the memory, oldest first: every candidate whose id was not in the
 * memory before the scan started.
 */
export function listCandidatesAddedByScan(params: {
  memory: IDiscoveryMemory | null;
  baselineCandidateIds: ReadonlySet<string>;
}): IDiscoveryMemoryCandidate[] {
  return (params.memory?.useCaseCandidates ?? [])
    .filter((candidate) => !params.baselineCandidateIds.has(candidate.id))
    .sort((first, second) => (first.createdAt ?? 0) - (second.createdAt ?? 0));
}

/**
 * The report's candidates: the scan's additions minus rejected ones, at most `maxCandidates`.
 * @param params.siteUrl - Start URL for a candidate that names none.
 */
export function toReportCandidates(params: {
  addedCandidates: IDiscoveryMemoryCandidate[];
  maxCandidates: number;
  siteUrl: string;
}): ILocalScanCandidate[] {
  return params.addedCandidates
    .filter((candidate) => candidate.status.toLowerCase() !== DROPPED_CANDIDATE_STATUS)
    .slice(0, params.maxCandidates)
    .map((candidate) => ({
      title: candidate.useCase.title ?? "",
      description: candidate.useCase.description ?? "",
      startUrl: candidate.useCase.url || params.siteUrl,
      requiresSignIn: isSignedInFlow(candidate.useCase),
    }));
}

/** The report status for how Studio exited and how many candidates the scan added. */
export function resolveLocalScanStatus(params: {
  exit: localQa.WebsiteScanExitEnum;
  addedCandidateCount: number;
  maxCandidates: number;
}): LocalScanStatusEnum {
  if (params.exit === localQa.WebsiteScanExitEnum.Failed) {
    return LocalScanStatusEnum.Error;
  }
  if (params.exit === localQa.WebsiteScanExitEnum.TimedOut || params.addedCandidateCount >= params.maxCandidates) {
    return LocalScanStatusEnum.Capped;
  }
  return LocalScanStatusEnum.Finished;
}
