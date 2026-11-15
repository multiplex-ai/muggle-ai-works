/**
 * `muggle scan --local` CLI handler.
 *
 * Runs a website scan (use-case discovery) in the local Studio on the model source the user chose, then
 * reports the candidates the scan added to the project's discovery memory. Candidates are reported, never
 * approved.
 */

import { randomUUID } from "node:crypto";
import * as path from "node:path";

import { e2e, getLogger, localQa } from "@muggleai/mcp";
import { LOCAL_SCAN_COMMAND_LOG_LEVEL, SCAN_REQUIRES_LOCAL_FLAG_MESSAGE } from "./local-scan-constants.js";
import { LocalScanStatusEnum } from "./local-scan-types.js";
import type {
  IDiscoveryMemory,
  IDiscoveryMemoryResponse,
  ILocalScanCommandOptions,
  ILocalScanReport,
} from "./local-scan-types.js";
import {
  listCandidatesAddedByScan,
  parseLocalScanLimits,
  resolveLocalScanStatus,
  toReportCandidates,
} from "./website-scan-candidates.js";

async function readDiscoveryMemoryAsync(projectId: string): Promise<IDiscoveryMemory | null> {
  const toolResult = await e2e.executeQaTool(
    e2e.USE_CASE_DISCOVERY_MEMORY_GET_TOOL_NAME,
    { projectId: projectId },
    randomUUID(),
  );
  if (toolResult.isError) {
    const failure = JSON.parse(String(toolResult.content)) as { message?: string };
    throw new Error(`Could not read the project's use-case discovery memory: ${failure.message ?? String(toolResult.content)}`);
  }
  return (JSON.parse(String(toolResult.content)) as IDiscoveryMemoryResponse).memory;
}

/** First line of a Studio failure plus where its full logs were kept. */
function summarizeScanFailure(params: { failureMessage: string | null; runId: string }): string {
  const headline = (params.failureMessage ?? "Studio failed.").split("\n")[0];
  const logsDir = path.join(localQa.getStorageService().getSessionsDir(), params.runId);
  return `${headline} Studio logs: ${logsDir}`;
}

/**
 * Scan a site locally and build the report.
 *
 * A project that already has a discovery memory keeps it: Studio appends to it, and only the candidates
 * this scan added are reported.
 */
export async function runLocalScanAsync(options: ILocalScanCommandOptions): Promise<ILocalScanReport> {
  const startedAt = Date.now();
  try {
    const limits = parseLocalScanLimits({
      maxCandidatesOption: options.maxCandidates,
      timeoutMsOption: options.timeoutMs,
      defaultTimeoutMs: localQa.DEFAULT_WEBSITE_SCAN_TIMEOUT_MS,
    });
    const memoryBeforeScan = await readDiscoveryMemoryAsync(options.projectId);
    const baselineCandidateIds = new Set((memoryBeforeScan?.useCaseCandidates ?? []).map((candidate) => candidate.id));

    const scanResult = await localQa.executeWebsiteScan({
      projectId: options.projectId,
      url: options.url,
      cwd: process.cwd(),
      useCaseDiscoverMemoryId: memoryBeforeScan?.id ?? randomUUID(),
      // Studio stops at a total memory count, so the existing candidates are added to the cap.
      targetUseCaseCandidateCount: baselineCandidateIds.size + limits.maxCandidates,
      timeoutMs: limits.timeoutMs,
      showUi: options.showUi,
    });

    const addedCandidates = listCandidatesAddedByScan({
      memory: await readDiscoveryMemoryAsync(options.projectId),
      baselineCandidateIds: baselineCandidateIds,
    });
    const status = resolveLocalScanStatus({
      exit: scanResult.exit,
      addedCandidateCount: addedCandidates.length,
      maxCandidates: limits.maxCandidates,
    });
    return {
      status: status,
      candidates: toReportCandidates({
        addedCandidates: addedCandidates,
        maxCandidates: limits.maxCandidates,
        siteUrl: options.url,
      }),
      durationMs: Date.now() - startedAt,
      error:
        status === LocalScanStatusEnum.Error
          ? summarizeScanFailure({ failureMessage: scanResult.failureMessage, runId: scanResult.runId })
          : null,
    };
  } catch (error) {
    return {
      status: LocalScanStatusEnum.Error,
      candidates: [],
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function renderLocalScanText(report: ILocalScanReport): string {
  const lines = [`Scan ${report.status}: ${report.candidates.length} candidate(s) in ${Math.round(report.durationMs / 1000)}s`];
  if (report.error) {
    lines.push(report.error);
  }
  for (const candidate of report.candidates) {
    lines.push(`  - ${candidate.title}${candidate.requiresSignIn ? " (signed in)" : ""}  ${candidate.startUrl}`);
  }
  return lines.join("\n");
}

/**
 * Run `muggle scan --local` and print its report; with `--json`, one JSON line.
 *
 * Exits 0 whenever a report was printed, including an `error` report. Without `--local`
 * it prints why and exits 1, since the CLI has no cloud scan.
 *
 * @param options - Parsed command options.
 */
export async function localScanCommand(options: ILocalScanCommandOptions): Promise<void> {
  if (!options.local) {
    console.error(SCAN_REQUIRES_LOCAL_FLAG_MESSAGE);
    process.exitCode = 1;
    return;
  }
  getLogger().level = LOCAL_SCAN_COMMAND_LOG_LEVEL;
  const report = await runLocalScanAsync(options);
  console.log(options.json ? JSON.stringify(report) : renderLocalScanText(report));
}
