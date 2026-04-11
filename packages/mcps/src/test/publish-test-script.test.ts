/**
 * Tests for muggle-local-publish-test-script.
 *
 * Covers the summaryStep plumbing: the tool must read summaryStep off the
 * stored test script and forward it in the upload request body so the
 * cloud action script retains the run verdict and final screenshot.
 *
 * See muggle-ai-prompt-service PR #405 for the companion backend fix.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  return {
    getLogger: () => fakeLogger,
    createChildLogger: () => fakeLogger,
    resetLogger: noop,
  };
});

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

const mockExecute = vi.fn();
vi.mock("../mcp/e2e/upstream-client.js", () => ({
  getPromptServiceClient: () => ({ execute: mockExecute }),
}));

const mockGetRunResult = vi.fn();
const mockGetTestScript = vi.fn();
const mockUpdateTestScript = vi.fn();
const mockUpdateRunResult = vi.fn();
const mockGetAuthStatus = vi.fn();

vi.mock("../mcp/local/services/index.js", () => ({
  cancelExecution: vi.fn(),
  executeReplay: vi.fn(),
  executeTestGeneration: vi.fn(),
  getAuthService: () => ({ getAuthStatus: mockGetAuthStatus }),
  getStorageService: () => ({
    getDataDir: () => "/tmp",
    getSessionsDir: () => "/tmp",
  }),
  getRunResultStorageService: () => ({
    getRunResult: mockGetRunResult,
    getTestScript: mockGetTestScript,
    updateTestScript: mockUpdateTestScript,
    updateRunResult: mockUpdateRunResult,
  }),
}));

import { getTool } from "../mcp/tools/local/tool-registry.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CLOUD_TEST_CASE_ID = "22222222-2222-4222-8222-222222222222";
const TEST_SCRIPT_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const USE_CASE_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "auth0|test-user";

const SUMMARY_STEP = {
  briefExplanation: "Success. Pricing section verified.",
  isSummaryStep: true,
  operation: {
    action: "halt",
    screenshotUrl: "gs://bucket/summary.jpg",
  },
  comment: "Verdict: goal achieved.",
  structuredSummary: {
    summaryHeadline: "Pricing section verified",
    status: "success",
    keyFindings: [],
    failureReason: null,
    nextActions: [],
    confidence: 1,
  },
};

const STEPS = [
  {
    briefExplanation: "navigate",
    operation: { action: "navigate", url: "http://localhost:3999/" },
  },
];

/**
 * Wire up a happy-path fixture for publishTestScriptTool. Individual tests
 * may override specific fields before invoking the tool.
 */
function seedHappyPath({
  includeSummaryStep,
}: {
  includeSummaryStep: boolean;
}): void {
  mockGetAuthStatus.mockReturnValue({
    authenticated: true,
    userId: USER_ID,
    email: "test@example.com",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    isExpired: false,
  });
  mockGetRunResult.mockReturnValue({
    id: RUN_ID,
    testScriptId: TEST_SCRIPT_ID,
    runType: "generation",
    status: "passed",
    projectId: PROJECT_ID,
    useCaseId: USE_CASE_ID,
    productionUrl: "https://staging.example.com/",
    executionTimeMs: 63217,
    localExecutionContext: {
      originalUrl: "http://localhost:3999/",
      productionUrl: "https://staging.example.com/",
      machineHostname: "test-host",
      osInfo: "darwin",
      electronAppVersion: "1.0.51",
      mcpServerVersion: "4.7.0",
      localExecutionCompletedAt: Date.now(),
    },
  });
  mockGetTestScript.mockReturnValue({
    id: TEST_SCRIPT_ID,
    name: "Test",
    url: "http://localhost:3999/",
    status: "generated",
    cloudTestCaseId: CLOUD_TEST_CASE_ID,
    actionScript: STEPS,
    summaryStep: includeSummaryStep ? SUMMARY_STEP : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  mockExecute.mockResolvedValue({
    data: {
      workflowRuntimeId: "runtime-1",
      workflowRunId: "run-1",
      testScriptId: "cloud-ts-1",
      actionScriptId: "cloud-as-1",
      viewUrl: "https://www.muggle-ai.com/...",
    },
  });
}

describe("muggle-local-publish-test-script — summaryStep forwarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards summaryStep in the upload body when present on the test script", async () => {
    seedHappyPath({ includeSummaryStep: true });

    const tool = getTool("muggle-local-publish-test-script");
    expect(tool).toBeDefined();

    const result = await tool!.execute({
      input: { runId: RUN_ID, cloudTestCaseId: CLOUD_TEST_CASE_ID },
      correlationId: "test-corr",
    } as never);

    expect(result.isError).toBe(false);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const call = mockExecute.mock.calls[0];
    const requestConfig = call[0] as { body: Record<string, unknown> };
    expect(requestConfig.body).toMatchObject({
      projectId: PROJECT_ID,
      useCaseId: USE_CASE_ID,
      testCaseId: CLOUD_TEST_CASE_ID,
      actionScript: STEPS,
      summaryStep: SUMMARY_STEP,
    });
  });

  it("forwards undefined summaryStep when the test script does not have one", async () => {
    seedHappyPath({ includeSummaryStep: false });

    const tool = getTool("muggle-local-publish-test-script");
    expect(tool).toBeDefined();

    const result = await tool!.execute({
      input: { runId: RUN_ID, cloudTestCaseId: CLOUD_TEST_CASE_ID },
      correlationId: "test-corr",
    } as never);

    expect(result.isError).toBe(false);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const requestConfig = mockExecute.mock.calls[0][0] as { body: Record<string, unknown> };
    expect(requestConfig.body.summaryStep).toBeUndefined();
    expect(requestConfig.body.actionScript).toEqual(STEPS);
  });
});
