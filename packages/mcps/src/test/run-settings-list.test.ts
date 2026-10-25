/**
 * Tests for muggle-remote-run-settings-list, which lists a test case's runSettings records in one
 * lane so a skill can name a record it has not run yet.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: { promptServiceBaseUrl: "http://test.invalid", requestTimeoutMs: 1000, workflowTimeoutMs: 1000 },
  }),
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

import { RunSettingsListInputSchema } from "../mcp/e2e/contracts/index.js";
import { GatewayError, McpErrorCode } from "../mcp/e2e/types.js";
import { executeQaTool, getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const TOOL_NAME = "muggle-remote-run-settings-list";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TEST_CASE_ID = "33333333-3333-4333-8333-333333333333";
const LOCAL_LIST_INPUT = { projectId: PROJECT_ID, testCaseId: TEST_CASE_ID, runEnvironmentType: "local" };

const phoneRecord = {
  id: "rs-390",
  projectId: PROJECT_ID,
  testCaseId: TEST_CASE_ID,
  laneType: "local",
  displayParams: { browserWindowWidth: 390, browserWindowHeight: 844 },
  featureFlags: { custom: { beta: true } },
  managedProfile: { profileId: "mp-1" },
  userSecrets: [{ id: "secret-1" }],
  producedByTestSpecVersion: 2,
};

const desktopRecord = {
  id: "rs-1920",
  projectId: PROJECT_ID,
  testCaseId: TEST_CASE_ID,
  laneType: "local",
  displayParams: { browserWindowWidth: 1920, browserWindowHeight: 1080 },
  producedByTestSpecVersion: 2,
};

async function runListTool(input: unknown): Promise<{ isError: boolean; output: Record<string, unknown> }> {
  const result = await executeQaTool(TOOL_NAME, input, "test-correlation-id");
  return { isError: result.isError === true, output: JSON.parse(result.content as string) };
}

beforeEach(() => {
  mockExecute.mockReset();
});

describe("muggle-remote-run-settings-list", () => {
  it("is registered and requires auth", () => {
    const tool = getQaToolByName(TOOL_NAME);
    expect(tool).toBeDefined();
    expect(tool!.requiresAuth).not.toBe(false);
  });

  it("asks for the test case's records in the named lane", async () => {
    mockExecute.mockResolvedValueOnce({ statusCode: 200, data: { runSettingsList: [] }, headers: {} });
    await runListTool(LOCAL_LIST_INPUT);
    expect(mockExecute).toHaveBeenCalledWith(
      {
        method: "GET",
        path: `/v1/protected/muggle-test/projects/${PROJECT_ID}/test-cases/${TEST_CASE_ID}/run-settings`,
        queryParams: { type: "local" },
      },
      { bearerToken: "test-token" },
      "test-correlation-id",
    );
  });

  it("returns each record's id, resolution and feature flags, and nothing else", async () => {
    mockExecute.mockResolvedValueOnce({
      statusCode: 200,
      data: { runSettingsList: [phoneRecord, desktopRecord] },
      headers: {},
    });
    const { isError, output } = await runListTool(LOCAL_LIST_INPUT);
    expect(isError).toBe(false);
    expect(output).toEqual({
      runSettingsList: [
        {
          runSettingsId: "rs-390",
          resolutionLabel: "390×844",
          displayResolution: "R_0390x0844",
          featureFlags: { custom: { beta: true } },
        },
        { runSettingsId: "rs-1920", resolutionLabel: "1920×1080", displayResolution: "R_1920x1080" },
      ],
    });
  });

  it("labels a size no displayResolution matches without inventing one", async () => {
    mockExecute.mockResolvedValueOnce({
      statusCode: 200,
      data: { runSettingsList: [{ id: "rs-odd", displayParams: { browserWindowWidth: 1280, browserWindowHeight: 720 } }] },
      headers: {},
    });
    const { output } = await runListTool(LOCAL_LIST_INPUT);
    expect(output).toEqual({ runSettingsList: [{ runSettingsId: "rs-odd", resolutionLabel: "1280×720" }] });
  });

  it("never marks a record primary, since the list does not say which one is", async () => {
    mockExecute.mockResolvedValueOnce({
      statusCode: 200,
      data: { runSettingsList: [phoneRecord, desktopRecord] },
      headers: {},
    });
    const { output } = await runListTool(LOCAL_LIST_INPUT);
    expect(JSON.stringify(output)).not.toMatch(/primary/i);
  });

  it("reports an upstream failure as a tool error", async () => {
    mockExecute.mockRejectedValueOnce(
      new GatewayError({ code: McpErrorCode.NOT_FOUND, message: "Test case not found", statusCode: 404 }),
    );
    const { isError, output } = await runListTool(LOCAL_LIST_INPUT);
    expect(isError).toBe(true);
    expect(output).toEqual({ error: "NOT_FOUND", message: "Test case not found" });
  });

  it("reports a body without a runSettingsList as an upstream error", async () => {
    mockExecute.mockResolvedValueOnce({ statusCode: 200, data: { testSpec: null }, headers: {} });
    const { isError, output } = await runListTool(LOCAL_LIST_INPUT);
    expect(isError).toBe(true);
    expect(output.error).toBe("UPSTREAM_ERROR");
  });

  it("requires the lane, since a record belongs to one", () => {
    expect(() => RunSettingsListInputSchema.parse({ projectId: PROJECT_ID, testCaseId: TEST_CASE_ID })).toThrow();
    expect(() =>
      RunSettingsListInputSchema.parse({ projectId: PROJECT_ID, testCaseId: TEST_CASE_ID, runEnvironmentType: "cloud" }),
    ).toThrow();
  });
});
