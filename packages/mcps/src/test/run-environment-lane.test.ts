/**
 * Tests for threading the environment lane (`runEnvironmentType`) through the
 * cloud generation and local-run upload contracts. A local run must reach the
 * cloud tagged `runEnvironmentType: "local"` so versioned runSettings resolve
 * the developer's localhost credentials instead of the remote managed-profile
 * pool. Omitting it must keep the pre-lane wire shape (backend defaults missing
 * → remote).
 */

import { describe, expect, it, vi } from "vitest";

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

import {
  LocalRunUploadInputSchema,
  RunEnvironment,
  WorkflowStartTestScriptGenerationInputSchema,
} from "../mcp/e2e/contracts/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USE_CASE_ID = "22222222-2222-4222-8222-222222222222";
const TEST_CASE_ID = "33333333-3333-4333-8333-333333333333";

function baseUploadInput(): Record<string, unknown> {
  return {
    projectId: PROJECT_ID,
    useCaseId: USE_CASE_ID,
    testCaseId: TEST_CASE_ID,
    runType: "generation",
    productionUrl: "https://staging.example.com/",
    localExecutionContext: {
      originalUrl: "http://localhost:3000/",
      productionUrl: "https://staging.example.com/",
      runByUserId: "auth0|test",
      localExecutionCompletedAt: 1,
      uploadedAt: 2,
    },
    actionScript: [{ step: 1 }],
    status: "passed",
    executionTimeMs: 100,
  };
}

describe("RunEnvironment lane contracts", () => {
  it("LocalRunUploadInputSchema accepts runEnvironmentType: local", () => {
    const parsed = LocalRunUploadInputSchema.parse({
      ...baseUploadInput(),
      runEnvironmentType: RunEnvironment.Local,
    });
    expect(parsed.runEnvironmentType).toBe(RunEnvironment.Local);
  });

  it("LocalRunUploadInputSchema leaves runEnvironmentType undefined when omitted", () => {
    const parsed = LocalRunUploadInputSchema.parse(baseUploadInput());
    expect(parsed.runEnvironmentType).toBeUndefined();
  });

  it("LocalRunUploadInputSchema rejects an unknown lane", () => {
    expect(() =>
      LocalRunUploadInputSchema.parse({ ...baseUploadInput(), runEnvironmentType: "preview" }),
    ).toThrow();
  });

  it("WorkflowStartTestScriptGenerationInputSchema accepts runEnvironmentType: local", () => {
    const parsed = WorkflowStartTestScriptGenerationInputSchema.parse({
      projectId: PROJECT_ID,
      useCaseId: USE_CASE_ID,
      testCaseId: TEST_CASE_ID,
      name: "gen",
      url: "https://staging.example.com/",
      goal: "goal",
      precondition: "pre",
      instructions: "do it",
      expectedResult: "done",
      runEnvironmentType: RunEnvironment.Local,
    });
    expect(parsed.runEnvironmentType).toBe(RunEnvironment.Local);
  });
});

describe("muggle-remote-local-run-upload lane forwarding", () => {
  it("forwards runEnvironmentType into the upload body when provided", () => {
    const tool = getQaToolByName("muggle-remote-local-run-upload")!;
    const call = tool.mapToUpstream({ ...baseUploadInput(), runEnvironmentType: RunEnvironment.Local });
    expect((call.body as Record<string, unknown>).runEnvironmentType).toBe(RunEnvironment.Local);
  });

  it("omits runEnvironmentType from the upload body when not provided", () => {
    const tool = getQaToolByName("muggle-remote-local-run-upload")!;
    const call = tool.mapToUpstream(baseUploadInput());
    expect(call.body as Record<string, unknown>).not.toHaveProperty("runEnvironmentType");
  });
});

describe("muggle-remote-workflow-start-test-script-generation lane forwarding", () => {
  function genInput(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      projectId: PROJECT_ID,
      useCaseId: USE_CASE_ID,
      testCaseId: TEST_CASE_ID,
      name: "gen",
      url: "https://staging.example.com/",
      goal: "goal",
      precondition: "pre",
      instructions: "do it",
      expectedResult: "done",
      ...extra,
    };
  }

  it("forwards runEnvironmentType: local into the workflow body", () => {
    const tool = getQaToolByName("muggle-remote-workflow-start-test-script-generation")!;
    const call = tool.mapToUpstream(genInput({ runEnvironmentType: RunEnvironment.Local }));
    expect((call.body as Record<string, unknown>).runEnvironmentType).toBe(RunEnvironment.Local);
  });

  it("omits runEnvironmentType from the workflow body when not provided", () => {
    const tool = getQaToolByName("muggle-remote-workflow-start-test-script-generation")!;
    const call = tool.mapToUpstream(genInput());
    expect(call.body as Record<string, unknown>).not.toHaveProperty("runEnvironmentType");
  });
});

describe("muggle-remote-test-script-list lane forwarding", () => {
  it("forwards runEnvironmentType as the runEnvironmentType query param when provided", () => {
    const tool = getQaToolByName("muggle-remote-test-script-list")!;
    const call = tool.mapToUpstream({
      projectId: PROJECT_ID,
      testCaseId: TEST_CASE_ID,
      runEnvironmentType: RunEnvironment.Local,
    });
    expect((call.queryParams as Record<string, unknown>).runEnvironmentType).toBe(
      RunEnvironment.Local,
    );
  });

  it("leaves the runEnvironmentType query param undefined when not provided", () => {
    const tool = getQaToolByName("muggle-remote-test-script-list")!;
    const call = tool.mapToUpstream({ projectId: PROJECT_ID, testCaseId: TEST_CASE_ID });
    expect((call.queryParams as Record<string, unknown>).runEnvironmentType).toBeUndefined();
  });
});
