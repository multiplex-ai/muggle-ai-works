/**
 * Cloud tools attach a `dashboardUrl` resolved against the MCP's own lane, so skills never build
 * a dashboard host themselves.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const DASHBOARD_BASE = "https://staging.muggle-ai.com/muggleTestV0/dashboard/projects";

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
  getDashboardBaseUrl: () => DASHBOARD_BASE,
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fakeLogger };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

const mockExecute = vi.fn();
vi.mock("../mcp/e2e/upstream-client.js", () => ({
  getPromptServiceClient: () => ({ execute: mockExecute }),
}));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { executeQaTool } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USE_CASE_ID = "22222222-2222-4222-8222-222222222222";
const TEST_CASE_ID = "33333333-3333-4333-8333-333333333333";
const TEST_SCRIPT_ID = "44444444-4444-4444-8444-444444444444";
const ACTION_SCRIPT_ID = "55555555-5555-4555-8555-555555555555";

async function runTool(toolName: string, input: unknown, upstreamData: unknown): Promise<Record<string, unknown>> {
  mockExecute.mockResolvedValueOnce({ statusCode: 200, data: upstreamData, headers: {} });
  const result = await executeQaTool(toolName, input, "test-correlation-id");
  expect(result.isError).toBe(false);
  return JSON.parse(result.content as string);
}

beforeEach(() => {
  mockExecute.mockReset();
});

describe("cloud tool dashboardUrl", () => {
  it("links a project to its overview on the MCP's lane", async () => {
    const output = await runTool("muggle-remote-project-get", { projectId: PROJECT_ID }, { id: PROJECT_ID, name: "Acme" });
    expect(output).toEqual({ id: PROJECT_ID, name: "Acme", dashboardUrl: `${DASHBOARD_BASE}/${PROJECT_ID}` });
  });

  it("links a fetched test script to its script details, pinned to its version", async () => {
    const output = await runTool(
      "muggle-remote-test-script-get",
      { testScriptId: TEST_SCRIPT_ID },
      { id: TEST_SCRIPT_ID, projectId: PROJECT_ID, testCaseId: TEST_CASE_ID, actionScriptId: ACTION_SCRIPT_ID },
    );
    expect(output.dashboardUrl).toBe(
      `${DASHBOARD_BASE}/${PROJECT_ID}/scripts?modal=script-details&testCaseId=${TEST_CASE_ID}&actionScriptId=${ACTION_SCRIPT_ID}`,
    );
  });

  it("links a fetched test case using the project the response names", async () => {
    const output = await runTool(
      "muggle-remote-test-case-get",
      { testCaseId: TEST_CASE_ID },
      { id: TEST_CASE_ID, projectId: PROJECT_ID },
    );
    expect(output.dashboardUrl).toBe(`${DASHBOARD_BASE}/${PROJECT_ID}/scripts?modal=script-details&testCaseId=${TEST_CASE_ID}`);
  });

  it("links a started replay to the script details of the test case it replays", async () => {
    const output = await runTool(
      "muggle-remote-workflow-start-test-script-replay",
      {
        projectId: PROJECT_ID,
        useCaseId: USE_CASE_ID,
        testCaseId: TEST_CASE_ID,
        testScriptId: TEST_SCRIPT_ID,
        name: "replay",
        workflowParams: {},
      },
      { workflowRuntimeId: "rt1" },
    );
    expect(output.dashboardUrl).toBe(`${DASHBOARD_BASE}/${PROJECT_ID}/scripts?modal=script-details&testCaseId=${TEST_CASE_ID}`);
  });

  it("adds no link when the response lacks an id the page needs", async () => {
    const output = await runTool("muggle-remote-test-case-get", { testCaseId: TEST_CASE_ID }, { id: TEST_CASE_ID });
    expect(output).not.toHaveProperty("dashboardUrl");
  });
});
