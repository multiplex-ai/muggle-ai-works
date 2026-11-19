/**
 * Flattens the pool's run view into one row an agent can read, keeping machinery status and test
 * verdict as separate fields.
 */

import { FINISHED_IOS_RUN_STATUSES } from "../../e2e/contracts/ios-pool-constants.js";
import { GatewayError, McpErrorCode, type IUpstreamResponse } from "../../e2e/types.js";
import type { IIosRunOutput, IRawIosRunEnvelope } from "./ios-run-transform-types.js";

/**
 * Maps a `{ run }` body to the run's identity, machinery status and verdict.
 *
 * Output shape: `{ run: { runId: "r-1", projectId: "p-1", artifactDigest: "9f…", deviceType: "iPhone-15", status: "completed", isFinished: true, verdict: "passed", stepCount: 12 } }`
 *
 * @throws GatewayError when the body carries no run with an id, project and status.
 */
export function mapIosRun(response: IUpstreamResponse): IIosRunOutput {
  const runView = (response.data as IRawIosRunEnvelope | undefined)?.run;
  const runRequest = runView?.record?.request;
  const runStatus = runView?.state?.status;
  if (!runView?.record?.runId || !runRequest?.projectId || !runStatus) {
    throw new GatewayError({
      code: McpErrorCode.UPSTREAM_ERROR,
      message: "iOS run response carried no run with an id, project and status.",
      statusCode: response.statusCode,
    });
  }

  const runResult = runView.result ?? undefined;
  return {
    run: {
      runId: runView.record.runId,
      projectId: runRequest.projectId,
      artifactDigest: runRequest.artifactDigest ?? "",
      deviceType: runRequest.deviceType ?? "",
      ...(runRequest.task && { task: runRequest.task }),
      ...(runRequest.useCaseId && { useCaseId: runRequest.useCaseId }),
      ...(runRequest.testCaseId && { testCaseId: runRequest.testCaseId }),
      status: runStatus,
      isFinished: FINISHED_IOS_RUN_STATUSES.includes(runStatus),
      verdict: runResult?.verdict ?? null,
      ...(runResult?.summary && { summary: runResult.summary }),
      ...(runResult?.evidence && { evidence: runResult.evidence }),
      ...(runResult?.stepCount !== undefined && { stepCount: runResult.stepCount }),
      attemptCount: runView.state?.attemptCount,
      maxAttempts: runView.state?.maxAttempts,
      createdAtMs: runView.record.createdAtMs,
      statusUpdatedAtMs: runView.state?.statusUpdatedAtMs,
    },
  };
}
