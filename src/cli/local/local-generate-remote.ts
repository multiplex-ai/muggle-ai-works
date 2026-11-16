import { e2e, getLogger } from "@muggleai/mcp";

import { UPLOADED_RUN_CLOCK_SKEW_MS } from "./local-generate-constants.js";
import type { IRemoteTestCaseRecord, IRemoteWorkflowRunRecord } from "./local-generate-types.js";

/**
 * Call a remote tool exactly as the MCP server does and return its parsed JSON payload.
 *
 * @param params.toolName - Remote tool to call.
 * @param params.toolInput - Its input.
 * @param params.correlationId - Correlation id shared by the command's calls.
 * @returns The tool's payload.
 * @throws Error carrying the tool's message when it reports an error.
 */
async function callRemoteToolAsync<TPayload>(params: {
  toolName: string;
  toolInput: Record<string, unknown>;
  correlationId: string;
}): Promise<TPayload> {
  const toolResult = await e2e.executeQaTool(params.toolName, params.toolInput, params.correlationId);
  const payload = JSON.parse(String(toolResult.content)) as TPayload & { message?: string };
  if (toolResult.isError) {
    throw new Error(`${params.toolName} failed: ${payload.message ?? String(toolResult.content)}`);
  }
  return payload;
}

/**
 * Fetch a cloud test case through `muggle-remote-test-case-get`.
 *
 * @param params.testCaseId - Test case to fetch.
 * @param params.correlationId - Correlation id shared by the command's calls.
 * @returns The test case record.
 * @throws Error when the backend refuses or cannot find it.
 */
export async function fetchRemoteTestCaseAsync(params: {
  testCaseId: string;
  correlationId: string;
}): Promise<IRemoteTestCaseRecord> {
  return await callRemoteToolAsync<IRemoteTestCaseRecord>({
    toolName: e2e.TEST_CASE_GET_TOOL_NAME,
    toolInput: { testCaseId: params.testCaseId },
    correlationId: params.correlationId,
  });
}

/**
 * Identify the cloud workflow run the studio filed a published generation under.
 *
 * The studio's publish response carries the run id but its sidecar does not, so this reads the
 * test case's latest generation run and accepts it only when it was created after the local run
 * started. Two generations of the same test case finishing together could be confused; the
 * action script id is the exact reference.
 *
 * @param params.testCaseId - Test case the run generated for.
 * @param params.runStartedAt - Epoch milliseconds the local run started.
 * @param params.correlationId - Correlation id shared by the command's calls.
 * @returns The workflow run id, or null when none matches or the lookup fails.
 */
export async function findUploadedRunIdAsync(params: {
  testCaseId: string;
  runStartedAt: number;
  correlationId: string;
}): Promise<string | null> {
  try {
    const latestRuntime = await callRemoteToolAsync<{ id?: unknown }>({
      toolName: e2e.LATEST_GENERATION_RUNTIME_BY_TEST_CASE_TOOL_NAME,
      toolInput: { testCaseId: params.testCaseId },
      correlationId: params.correlationId,
    });
    if (typeof latestRuntime.id !== "string") {
      return null;
    }
    const latestRun = await callRemoteToolAsync<IRemoteWorkflowRunRecord>({
      toolName: e2e.GENERATION_LATEST_RUN_TOOL_NAME,
      toolInput: { workflowRuntimeId: latestRuntime.id },
      correlationId: params.correlationId,
    });
    const isThisRun =
      typeof latestRun.id === "string" &&
      typeof latestRun.createdAt === "number" &&
      latestRun.createdAt >= params.runStartedAt - UPLOADED_RUN_CLOCK_SKEW_MS &&
      latestRun.taskDef?.testCaseId === params.testCaseId;
    return isThisRun ? (latestRun.id as string) : null;
  } catch (error) {
    getLogger().warn("Could not identify the uploaded generation run", {
      testCaseId: params.testCaseId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
