/** Tests for Light mode inputs: the remote workflowParams.llm override, the local lightMode flag, and the run report line. */

import { describe, expect, it } from "vitest";

import { WorkflowParamsSchema } from "../mcp/e2e/contracts/index.js";
import { ExecuteReplayInputSchema, ExecuteTestGenerationInputSchema } from "../mcp/local/contracts/project-schemas.js";
import { formatLlmTierLine } from "../mcp/tools/local/llm-tier-line.js";
import { LlmTierEnum } from "../shared/llm-tier-types.js";

const TEST_CASE_ID = "11111111-1111-4111-8111-111111111111";
const TEST_SCRIPT_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_SCRIPT_ID = "33333333-3333-4333-8333-333333333333";
const PARENT_IDS = { projectId: "44444444-4444-4444-8444-444444444444", useCaseId: "55555555-5555-4555-8555-555555555555" };
const LOCAL_RUN_BASE = { localUrl: "http://localhost:3000", cwd: "C:/repo", testCaseDescription: "Log in with the seeded account" };
const TEST_CASE = {
  ...PARENT_IDS,
  id: TEST_CASE_ID,
  title: "Login",
  description: "Log in with the seeded account",
  goal: "User can log in",
  expectedResult: "Dashboard shown",
  url: "https://staging.example.com",
};
const TEST_SCRIPT = {
  ...PARENT_IDS,
  id: TEST_SCRIPT_ID,
  name: "Login replay",
  testCaseId: TEST_CASE_ID,
  actionScriptId: ACTION_SCRIPT_ID,
  url: "https://staging.example.com",
};

describe("WorkflowParamsSchema llm", () => {
  it("accepts the light tier", () => {
    expect(WorkflowParamsSchema.parse({ llm: { tier: "light" } })).toEqual({ llm: { tier: LlmTierEnum.Light } });
  });

  it("accepts an llm override without a tier", () => {
    expect(WorkflowParamsSchema.parse({ llm: {} })).toEqual({ llm: {} });
  });

  it("keeps other workflow params beside llm", () => {
    const parsedParams = WorkflowParamsSchema.parse({ llm: { tier: "standard" }, memory: { enableEverMemOS: true }, extra: 1 });
    expect(parsedParams).toEqual({ llm: { tier: LlmTierEnum.Standard }, memory: { enableEverMemOS: true }, extra: 1 });
  });

  it("rejects an unknown tier", () => {
    expect(WorkflowParamsSchema.safeParse({ llm: { tier: "turbo" } }).success).toBe(false);
  });
});

describe("local execute lightMode", () => {
  it("accepts lightMode on test generation", () => {
    const parsedInput = ExecuteTestGenerationInputSchema.parse({ ...LOCAL_RUN_BASE, testCase: TEST_CASE, lightMode: true });
    expect(parsedInput.lightMode).toBe(true);
  });

  it("accepts lightMode on replay", () => {
    const parsedInput = ExecuteReplayInputSchema.parse({ ...LOCAL_RUN_BASE, testScript: TEST_SCRIPT, actionScript: [], lightMode: true });
    expect(parsedInput.lightMode).toBe(true);
  });

  it("leaves lightMode undefined when omitted", () => {
    const parsedInput = ExecuteTestGenerationInputSchema.parse({ ...LOCAL_RUN_BASE, testCase: TEST_CASE });
    expect(parsedInput.lightMode).toBeUndefined();
  });

  it("rejects a non-boolean lightMode", () => {
    expect(ExecuteReplayInputSchema.safeParse({ ...LOCAL_RUN_BASE, testScript: TEST_SCRIPT, actionScript: [], lightMode: "yes" }).success).toBe(false);
  });
});

describe("formatLlmTierLine", () => {
  it("reports Light mode", () => {
    expect(formatLlmTierLine(true)).toBe("**Model tier:** Light mode");
  });

  it("reports Standard when Light mode is off or absent", () => {
    expect(formatLlmTierLine(false)).toBe("**Model tier:** Standard");
    expect(formatLlmTierLine(undefined)).toBe("**Model tier:** Standard");
  });
});
