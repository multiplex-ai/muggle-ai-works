/**
 * Tests for status changes through muggle-remote-test-case-update.
 *
 * Covers:
 *   - a status reaching the test case state endpoint, never the definition write that drops it
 *   - a status alongside definition fields: definition first, status second, the case returned with both
 *   - a backend 409 for a status the lifecycle does not reach failing the call loudly
 */

import { describe, expect, it, vi } from "vitest";

const upstreamClientHolder = vi.hoisted(() => ({ promptServiceClient: undefined as unknown }));

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: {
      promptServiceBaseUrl: "http://test.invalid",
      requestTimeoutMs: 1000,
      workflowTimeoutMs: 1000,
    },
  }),
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    verbose: noop,
    silly: noop,
    child: () => fakeLogger,
  };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

vi.mock("../mcp/e2e/upstream-client.js", async (importOriginal) => {
  const actualModule = await importOriginal<typeof import("../mcp/e2e/upstream-client.js")>();
  return { ...actualModule, getPromptServiceClient: () => upstreamClientHolder.promptServiceClient };
});

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { McpErrorCode } from "../mcp/e2e/types.js";
import { PromptServiceClient } from "../mcp/e2e/upstream-client.js";
import { executeQaTool, getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const UPDATE_TOOL_NAME = "muggle-remote-test-case-update";
const TEST_CASE_ID = "66666666-6666-4666-8666-666666666666";
const TEST_CASE_PATH = `/v1/protected/muggle-test/test-cases/${TEST_CASE_ID}`;

interface IRecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

interface IBackendReply {
  statusCode: number;
  responseBody: unknown;
}

function mapToolCalls(toolInput: Record<string, unknown>) {
  const tool = getQaToolByName(UPDATE_TOOL_NAME)!;
  const parsedInput = tool.inputSchema.parse(toolInput);
  return {
    primaryCall: tool.mapToUpstream(parsedInput),
    followUpCalls: tool.mapToFollowUpUpstream?.(parsedInput) ?? [],
  };
}

function answerUpstreamInOrder(backendReplies: IBackendReply[]): IRecordedRequest[] {
  const recordedRequests: IRecordedRequest[] = [];
  const promptServiceClient = new PromptServiceClient();
  // The instance builds its own axios client; answer each request with the next backend reply.
  (promptServiceClient as unknown as { httpClient: { request: (config: unknown) => Promise<unknown> } }).httpClient = {
    request: (config: unknown) => {
      const requestConfig = config as { method: string; url: string; data: unknown };
      recordedRequests.push({ method: requestConfig.method, url: requestConfig.url, body: requestConfig.data });
      const backendReply = backendReplies[recordedRequests.length - 1];
      return Promise.resolve({ status: backendReply.statusCode, data: backendReply.responseBody, headers: {} });
    },
  };
  upstreamClientHolder.promptServiceClient = promptServiceClient;
  return recordedRequests;
}

describe("muggle-remote-test-case-update status routing", () => {
  it("writes a lone status through the test case state endpoint", () => {
    const { primaryCall, followUpCalls } = mapToolCalls({ testCaseId: TEST_CASE_ID, status: "DEPRECATED" });

    expect(primaryCall).toEqual({ method: "PUT", path: `${TEST_CASE_PATH}/state`, body: { status: "DEPRECATED" } });
    expect(followUpCalls).toEqual([]);
  });

  it("writes definition fields first and the status second, keeping status out of the definition body", () => {
    const { primaryCall, followUpCalls } = mapToolCalls({
      testCaseId: TEST_CASE_ID,
      title: "Renamed",
      status: "ARCHIVED",
    });

    expect(primaryCall).toEqual({ method: "PUT", path: TEST_CASE_PATH, body: { id: TEST_CASE_ID, title: "Renamed" } });
    expect(followUpCalls).toEqual([{ method: "PUT", path: `${TEST_CASE_PATH}/state`, body: { status: "ARCHIVED" } }]);
  });

  it("leaves a definition-only edit as one definition write", () => {
    const { primaryCall, followUpCalls } = mapToolCalls({ testCaseId: TEST_CASE_ID, priority: "HIGH" });

    expect(primaryCall).toEqual({ method: "PUT", path: TEST_CASE_PATH, body: { id: TEST_CASE_ID, priority: "HIGH" } });
    expect(followUpCalls).toEqual([]);
  });

  it("returns the case the status write answers with, after both writes ran in order", async () => {
    const recordedRequests = answerUpstreamInOrder([
      { statusCode: 200, responseBody: { id: TEST_CASE_ID, title: "Renamed", status: "ACTIVE" } },
      { statusCode: 200, responseBody: { id: TEST_CASE_ID, title: "Renamed", status: "ARCHIVED" } },
    ]);

    const toolResult = await executeQaTool(
      UPDATE_TOOL_NAME,
      { testCaseId: TEST_CASE_ID, title: "Renamed", status: "ARCHIVED" },
      "correlation-1",
    );

    expect(toolResult.isError).toBe(false);
    expect(recordedRequests.map((recordedRequest) => recordedRequest.url)).toEqual([
      expect.stringContaining(TEST_CASE_PATH),
      expect.stringContaining(`${TEST_CASE_PATH}/state`),
    ]);
    expect(recordedRequests[1].body).toEqual({ status: "ARCHIVED" });
    expect(JSON.parse(toolResult.content)).toMatchObject({ status: "ARCHIVED", title: "Renamed" });
  });

  it("fails loudly with the backend's message when the lifecycle does not reach the status", async () => {
    const backendMessage = "Cannot change test case status from [DRAFT] to [DEPRECATED]; reachable statuses: [ACTIVE, ARCHIVED].";
    answerUpstreamInOrder([
      { statusCode: 409, responseBody: { error: backendMessage, currentStatus: "DRAFT", allowedStatuses: ["ACTIVE", "ARCHIVED"] } },
    ]);

    const toolResult = await executeQaTool(
      UPDATE_TOOL_NAME,
      { testCaseId: TEST_CASE_ID, status: "DEPRECATED" },
      "correlation-2",
    );

    expect(toolResult.isError).toBe(true);
    expect(JSON.parse(toolResult.content)).toEqual({ error: McpErrorCode.INVALID_ARGUMENT, message: backendMessage });
  });
});
