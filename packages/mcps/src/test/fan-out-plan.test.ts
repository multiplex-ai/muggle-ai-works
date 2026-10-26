/**
 * Tests for muggle-remote-fan-out-plan, which asks the backend for a test case's records in start order on
 * one lane and whether the others wait on the primary, so a local run can fan out itself.
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

import { FanOutChoice, FanOutPlanInputSchema } from "../mcp/e2e/contracts/index.js";
import { GatewayError, McpErrorCode } from "../mcp/e2e/types.js";
import { executeQaTool, getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const TOOL_NAME = "muggle-remote-fan-out-plan";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TEST_CASE_ID = "33333333-3333-4333-8333-333333333333";
const LOCAL_PLAN_INPUT = { projectId: PROJECT_ID, testCaseId: TEST_CASE_ID, runEnvironmentType: "local" };
const FAN_OUT_PLAN_PATH = `/v1/protected/muggle-test/projects/${PROJECT_ID}/test-cases/${TEST_CASE_ID}/fan-out/plan`;

const gatedLocalPlan = {
  testCaseId: TEST_CASE_ID,
  laneType: "local",
  fanOutPolicy: "primaryFirst",
  fanOutChoice: "followPolicy",
  isPrimaryKnownGood: false,
  isSecondaryGatedOnPrimary: true,
  records: [
    {
      runSettingsId: "rs-1",
      resolutionLabel: "1920×1080",
      displayResolution: "R_1920x1080",
      isPrimary: true,
      testScriptId: "ts-1",
    },
    { runSettingsId: "rs-2", resolutionLabel: "390×844", displayResolution: "R_0390x0844", isPrimary: false },
  ],
  notRunRunSettingsIds: [],
};

async function runPlanTool(input: unknown): Promise<{ isError: boolean; output: Record<string, unknown> }> {
  const result = await executeQaTool(TOOL_NAME, input, "test-correlation-id");
  return { isError: result.isError === true, output: JSON.parse(result.content as string) };
}

beforeEach(() => {
  mockExecute.mockReset();
});

describe("muggle-remote-fan-out-plan", () => {
  it("is registered and requires auth", () => {
    const tool = getQaToolByName(TOOL_NAME);
    expect(tool).toBeDefined();
    expect(tool!.requiresAuth).not.toBe(false);
  });

  it("posts the plan request for the named lane with an empty body when no choice is given", async () => {
    mockExecute.mockResolvedValueOnce({ statusCode: 200, data: gatedLocalPlan, headers: {} });
    await runPlanTool(LOCAL_PLAN_INPUT);
    expect(mockExecute).toHaveBeenCalledWith(
      { method: "POST", path: FAN_OUT_PLAN_PATH, queryParams: { type: "local" }, body: {} },
      { bearerToken: "test-token" },
      "test-correlation-id",
    );
  });

  it.each([FanOutChoice.FollowPolicy, FanOutChoice.PrimaryOnly, FanOutChoice.AllNow])(
    "sends fanOutChoice %s as the only body field",
    async (fanOutChoice) => {
      mockExecute.mockResolvedValueOnce({ statusCode: 200, data: gatedLocalPlan, headers: {} });
      await runPlanTool({ ...LOCAL_PLAN_INPUT, runEnvironmentType: "remote", fanOutChoice: fanOutChoice });
      expect(mockExecute).toHaveBeenCalledWith(
        { method: "POST", path: FAN_OUT_PLAN_PATH, queryParams: { type: "remote" }, body: { fanOutChoice: fanOutChoice } },
        { bearerToken: "test-token" },
        "test-correlation-id",
      );
    },
  );

  it("returns the plan as the backend answered it, records in start order", async () => {
    mockExecute.mockResolvedValueOnce({ statusCode: 200, data: gatedLocalPlan, headers: {} });
    const { isError, output } = await runPlanTool(LOCAL_PLAN_INPUT);
    expect(isError).toBe(false);
    expect(output).toEqual(gatedLocalPlan);
  });

  it("tells the caller to gate the rest on the primary's run", () => {
    const description = getQaToolByName(TOOL_NAME)!.description;
    expect(description).toContain("run records[0] first");
    expect(description).toContain(
      "When isSecondaryGatedOnPrimary is true, run the rest only if that run passed, and otherwise report each as skipped because the primary failed",
    );
  });

  it("reports an upstream failure as a tool error", async () => {
    mockExecute.mockRejectedValueOnce(
      new GatewayError({ code: McpErrorCode.NOT_FOUND, message: "Test case not found", statusCode: 404 }),
    );
    const { isError, output } = await runPlanTool(LOCAL_PLAN_INPUT);
    expect(isError).toBe(true);
    expect(output).toEqual({ error: "NOT_FOUND", message: "Test case not found" });
  });

  it("requires the lane, since a record belongs to one", () => {
    expect(() => FanOutPlanInputSchema.parse({ projectId: PROJECT_ID, testCaseId: TEST_CASE_ID })).toThrow();
    expect(() => FanOutPlanInputSchema.parse({ ...LOCAL_PLAN_INPUT, runEnvironmentType: "cloud" })).toThrow();
  });

  it("rejects an unknown fanOutChoice", () => {
    expect(FanOutPlanInputSchema.safeParse({ ...LOCAL_PLAN_INPUT, fanOutChoice: "secondaryOnly" }).success).toBe(false);
  });
});
