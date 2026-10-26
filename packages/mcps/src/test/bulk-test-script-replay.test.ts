/**
 * Tests for the bulk test script replay tool's `fanOutChoice` input and its request body.
 */

import { describe, expect, it, vi } from "vitest";

// Stub config and logger so importing the tool registry does not load the repo-root
// package.json muggleConfig.
vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: {
      promptServiceBaseUrl: "http://test.invalid",
      requestTimeoutMs: 1000,
      workflowTimeoutMs: 5000,
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
  return {
    getLogger: () => fakeLogger,
    createChildLogger: () => fakeLogger,
    resetLogger: noop,
  };
});

vi.mock("../mcp/e2e/upstream-client.js", () => ({
  getPromptServiceClient: () => ({ execute: vi.fn() }),
}));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { FanOutChoice, WorkflowStartTestScriptReplayBulkInputSchema } from "../mcp/e2e/contracts/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TEST_CASE_ID = "22222222-2222-4222-8222-222222222222";
const BULK_REPLAY_TOOL_NAME = "muggle-remote-workflow-start-test-script-replay-bulk";

function buildBulkReplayInput(extraFields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    name: "bulk replay",
    intervalSec: -1,
    testCaseIds: [TEST_CASE_ID],
    ...extraFields,
  };
}

function buildBulkReplayRequestBody(extraFields: Record<string, unknown> = {}): Record<string, unknown> {
  const parsedInput = WorkflowStartTestScriptReplayBulkInputSchema.parse(buildBulkReplayInput(extraFields));
  return getQaToolByName(BULK_REPLAY_TOOL_NAME)!.mapToUpstream(parsedInput).body as Record<string, unknown>;
}

describe("muggle-remote-workflow-start-test-script-replay-bulk fanOutChoice", () => {
  it.each([FanOutChoice.FollowPolicy, FanOutChoice.PrimaryOnly, FanOutChoice.AllNow])(
    "forwards fanOutChoice %s into the request body",
    (fanOutChoice) => {
      const requestBody = buildBulkReplayRequestBody({ fanOutChoice: fanOutChoice });

      expect(requestBody.fanOutChoice).toBe(fanOutChoice);
    },
  );

  it("posts to the bulk replay workflow runtimes endpoint with the choice alongside the other fields", () => {
    const parsedInput = WorkflowStartTestScriptReplayBulkInputSchema.parse(
      buildBulkReplayInput({ fanOutChoice: FanOutChoice.PrimaryOnly }),
    );

    const upstreamCall = getQaToolByName(BULK_REPLAY_TOOL_NAME)!.mapToUpstream(parsedInput);

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(
      "/v1/protected/muggle-test/workflow/test-script/test-script-replay/bulk/workflowRuntimes",
    );
    expect(JSON.parse(JSON.stringify(upstreamCall.body))).toEqual({
      projectId: PROJECT_ID,
      name: "bulk replay",
      intervalSec: -1,
      testCaseIds: [TEST_CASE_ID],
      fanOutChoice: FanOutChoice.PrimaryOnly,
    });
  });

  it("omits fanOutChoice from the request body when not given, so the backend follows each lane's policy", () => {
    const requestBody = buildBulkReplayRequestBody();

    expect(requestBody).not.toHaveProperty("fanOutChoice");
  });

  it("rejects an unknown fanOutChoice", () => {
    const parseResult = WorkflowStartTestScriptReplayBulkInputSchema.safeParse(
      buildBulkReplayInput({ fanOutChoice: "secondaryOnly" }),
    );

    expect(parseResult.success).toBe(false);
  });
});
