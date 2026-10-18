import * as fs from "fs/promises";
import * as path from "path";

import { getLogger } from "../../../shared/logger.js";
import { STOP_REQUEST_FILE_SUFFIX, STOP_REQUEST_GRACE_MS } from "./execution-stop-constants.js";
import { RunStopReasonEnum, type IStoppableProcess } from "./execution-stop-types.js";
import type { RunResultStatus } from "./run-result-storage-service.js";

const logger = getLogger();

/**
 * Path of the file that asks the studio to stop a run.
 *
 * @param params.tempDir - The MCP temp dir the run's input file lives in.
 * @param params.runId - The run to stop.
 * @returns `<tempDir>/<runId>_stop_requested`
 */
export function buildStopRequestFilePath(params: { tempDir: string; runId: string }): string {
  return path.join(params.tempDir, `${params.runId}${STOP_REQUEST_FILE_SUFFIX}`);
}

/**
 * Asks a running studio to stop — so it ends between steps, publishes what it recorded and quits — and schedules
 * a hard kill for when it has not exited by the end of the grace period. A studio that predates stop requests
 * ignores the file and is hard-killed after the grace, as before.
 *
 * @param params.tempDir - The MCP temp dir the studio watches.
 * @param params.runId - The run to stop.
 * @param params.reason - Why it is being stopped; written into the request.
 * @param params.child - The studio process.
 * @returns The hard-kill timer, for the caller to clear once the process exits.
 */
export async function requestGracefulStopAsync(params: {
  tempDir: string;
  runId: string;
  reason: RunStopReasonEnum;
  child: IStoppableProcess;
}): Promise<ReturnType<typeof setTimeout>> {
  try {
    await fs.writeFile(buildStopRequestFilePath(params), params.reason, "utf-8");
  } catch (writeError) {
    logger.warn("Could not write the stop request; the run will be hard-killed after the grace period", {
      runId: params.runId,
      error: writeError instanceof Error ? writeError.message : String(writeError),
    });
  }

  return setTimeout(() => {
    if (params.child.exitCode === null && params.child.signalCode === null) {
      logger.warn("Run did not stop within the grace period; killing it", {
        runId: params.runId,
        graceMs: STOP_REQUEST_GRACE_MS,
      });
      params.child.kill("SIGTERM");
    }
  }, STOP_REQUEST_GRACE_MS);
}

/**
 * Removes a run's stop request. Silent when there is none.
 *
 * @param params.tempDir - The MCP temp dir.
 * @param params.runId - The run.
 */
export async function removeStopRequestFileAsync(params: { tempDir: string; runId: string }): Promise<void> {
  await fs.unlink(buildStopRequestFilePath(params)).catch(() => undefined);
}

/**
 * The stored status of a run the MCP stopped.
 *
 * @param reason - Why it was stopped.
 * @returns `"cancelled"` for a user cancel, otherwise `"failed"`.
 */
export function resolveStoppedRunStatus(reason: RunStopReasonEnum): RunResultStatus {
  return reason === RunStopReasonEnum.Cancelled ? "cancelled" : "failed";
}

/**
 * The error message recorded for a run the MCP stopped.
 *
 * @param params.reason - Why it was stopped.
 * @param params.timeoutMs - The run's time limit.
 * @returns e.g. `"Run stopped: it exceeded its 480000ms time limit."`
 */
export function describeStoppedRun(params: { reason: RunStopReasonEnum; timeoutMs: number }): string {
  if (params.reason === RunStopReasonEnum.Cancelled) {
    return "Run cancelled by user.";
  }
  return `Run stopped: it exceeded its ${params.timeoutMs}ms time limit.`;
}
