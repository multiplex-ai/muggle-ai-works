/** Tests that every tool writing or running a test case says where its limits live, and what a use case edit does to them. */

import { describe, expect, it, vi } from "vitest";

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
  const fake = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fake };
  return { getLogger: () => fake, createChildLogger: () => fake, resetLogger: noop };
});

vi.mock("../mcp/e2e/upstream-client.js", () => ({ getPromptServiceClient: () => ({ execute: vi.fn() }) }));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { ExecuteReplayInputSchema, ExecuteTestGenerationInputSchema } from "../mcp/local/contracts/project-schemas.js";
import { allQaToolDefinitions } from "../mcp/tools/e2e/tool-registry.js";
import { allLocalQaTools } from "../mcp/tools/local/index.js";
import { TEST_CASE_LIMIT_GUIDANCE, USE_CASE_REGENERATION_WARNING } from "../shared/test-case-limit-constants.js";

const allTools = [...allQaToolDefinitions, ...allLocalQaTools] as Array<{ name: string; description: string }>;

const descriptionOf = (toolName: string): string => {
  const tool = allTools.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`No tool named ${toolName}`);
  return tool.description;
};

const TEST_CASE_ID = "11111111-1111-4111-8111-111111111111";
const PARENT_IDS = { projectId: "44444444-4444-4444-8444-444444444444", useCaseId: "55555555-5555-4555-8555-555555555555" };
const LOCAL_RUN_BASE = { localUrl: "http://localhost:3000", cwd: "C:/repo" };
const TEST_CASE = { ...PARENT_IDS, id: TEST_CASE_ID, title: "Login", goal: "User can log in", expectedResult: "Dashboard shown" };
const TEST_SCRIPT = {
  ...PARENT_IDS,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Login replay",
  testCaseId: TEST_CASE_ID,
  actionScriptId: "33333333-3333-4333-8333-333333333333",
};

describe("limit guidance on the tools", () => {
  it.each([
    "muggle-remote-test-case-create",
    "muggle-remote-test-case-update",
    "muggle-remote-workflow-start-test-script-generation",
    "muggle-local-execute-test-generation",
    "muggle-local-execute-replay",
  ])("%s says where a test's limits live", (toolName) => {
    expect(descriptionOf(toolName)).toContain(TEST_CASE_LIMIT_GUIDANCE);
  });

  it.each(["muggle-remote-use-case-update", "muggle-remote-use-case-update-from-prompt"])(
    "%s warns that regeneration drops stored limits",
    (toolName) => {
      expect(descriptionOf(toolName)).toContain(USE_CASE_REGENERATION_WARNING);
    },
  );
});

describe("stored description on the local run inputs", () => {
  it("keeps the stored description a generation receives", () => {
    const parsedInput = ExecuteTestGenerationInputSchema.parse({
      ...LOCAL_RUN_BASE,
      testCase: { ...TEST_CASE, description: "Touch only the chat panel." },
    });

    expect(parsedInput.testCase.description).toBe("Touch only the chat panel.");
  });

  it("refuses a generation whose test case carries no stored description", () => {
    expect(ExecuteTestGenerationInputSchema.safeParse({ ...LOCAL_RUN_BASE, testCase: TEST_CASE }).success).toBe(false);
  });

  it("refuses a replay that carries no stored description", () => {
    expect(ExecuteReplayInputSchema.safeParse({ ...LOCAL_RUN_BASE, testScript: TEST_SCRIPT, actionScript: [] }).success).toBe(false);
  });
});
