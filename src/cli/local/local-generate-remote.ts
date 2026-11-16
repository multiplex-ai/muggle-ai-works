import { e2e } from "@muggleai/mcp";

import type { IRemoteTestCaseRecord } from "./local-generate-types.js";

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
