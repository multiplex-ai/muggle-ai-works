/**
 * Tests for the test state coverage tools on the cloud E2E registry.
 *
 * Covers:
 *   - each tool's input schema and the upstream verb, path and body it maps to
 *   - the test state fields test-case create and update pass through, with null clearing
 *   - the plan preview advertising that it runs nothing
 *   - backend 409 `{ error }` messages reaching the caller unchanged
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

// The real client stays importable so backend responses can run through it end to end.
vi.mock("../mcp/e2e/upstream-client.js", async (importOriginal) => {
  const actualModule = await importOriginal<typeof import("../mcp/e2e/upstream-client.js")>();
  return { ...actualModule, getPromptServiceClient: () => upstreamClientHolder.promptServiceClient };
});

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import {
  TestRoleCreateInputSchema,
  TestRoleSourceEnum,
  TestStateCreateInputSchema,
  TestStateFactScopeEnum,
  TestStateSettingsUpdateInputSchema,
  TestStateUpdateInputSchema,
} from "../mcp/e2e/contracts/index.js";
import { McpErrorCode } from "../mcp/e2e/types.js";
import { PromptServiceClient } from "../mcp/e2e/upstream-client.js";
import { executeQaTool, getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const STATE_ID = "22222222-2222-4222-8222-222222222222";
const ROLE_ID = "33333333-3333-4333-8333-333333333333";
const RESULT_STATE_ID = "44444444-4444-4444-8444-444444444444";
const USE_CASE_ID = "55555555-5555-4555-8555-555555555555";
const TEST_CASE_ID = "66666666-6666-4666-8666-666666666666";
const PROJECT_PATH = `/v1/protected/muggle-test/projects/${PROJECT_ID}`;
const ACCOUNT_SET_FACT = { statement: "the patient has one booked appointment", scope: TestStateFactScopeEnum.ACCOUNT_SET, roleId: null };
const ACCOUNT_FACT = { statement: "the doctor's unread count is one", scope: TestStateFactScopeEnum.ACCOUNT, roleId: ROLE_ID };
const STATE_CREATE_INPUT = {
  projectId: PROJECT_ID,
  name: "Message unread",
  facts: [ACCOUNT_SET_FACT, ACCOUNT_FACT],
  check: "the thread shows one unread message",
};
const TEST_CASE_CREATE_INPUT = {
  projectId: PROJECT_ID,
  useCaseId: USE_CASE_ID,
  title: "Send message",
  description: "Patient sends the doctor a message",
  goal: "The doctor has one unread message",
  expectedResult: "The thread shows one unread message",
  url: "https://staging.example.com",
};

function mapToolInput(toolName: string, toolInput: Record<string, unknown>) {
  const tool = getQaToolByName(toolName)!;
  return tool.mapToUpstream(tool.inputSchema.parse(toolInput));
}

function answerUpstreamWith(statusCode: number, responseBody: unknown): void {
  const promptServiceClient = new PromptServiceClient();
  // The instance builds its own axios client; answer every request with the given backend response.
  (promptServiceClient as unknown as { httpClient: { request: () => Promise<unknown> } }).httpClient = {
    request: () => Promise.resolve({ status: statusCode, data: responseBody, headers: {} }),
  };
  upstreamClientHolder.promptServiceClient = promptServiceClient;
}

describe("muggle-remote-test-state-catalog-get", () => {
  it("reads the project's catalog", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-state-catalog-get", { projectId: PROJECT_ID });

    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe(`${PROJECT_PATH}/test-state-catalog`);
    expect(upstreamCall.body).toBeUndefined();
  });
});

describe("muggle-remote-test-state-settings-update", () => {
  it("puts only the provided settings, keeping a null that clears the fresh account set state", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-state-settings-update", {
      projectId: PROJECT_ID,
      freshAccountSetStateId: null,
    });

    expect(upstreamCall.method).toBe("PUT");
    expect(upstreamCall.path).toBe(`${PROJECT_PATH}/test-state-catalog/settings`);
    expect(upstreamCall.body).toEqual({ freshAccountSetStateId: null });
  });

  it("sends both settings when given", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-state-settings-update", {
      projectId: PROJECT_ID,
      freshAccountSetStateId: STATE_ID,
      parallelAccountSetLimit: 3,
    });

    expect(upstreamCall.body).toEqual({ freshAccountSetStateId: STATE_ID, parallelAccountSetLimit: 3 });
  });

  it.each([
    ["a limit below 1", { projectId: PROJECT_ID, parallelAccountSetLimit: 0 }],
    ["a limit above 20", { projectId: PROJECT_ID, parallelAccountSetLimit: 21 }],
    ["a fractional limit", { projectId: PROJECT_ID, parallelAccountSetLimit: 2.5 }],
    ["a freshAccountSetStateId that is not a UUID", { projectId: PROJECT_ID, freshAccountSetStateId: "New patient" }],
  ])("rejects %s", (_caseName, toolInput) => {
    expect(TestStateSettingsUpdateInputSchema.safeParse(toolInput).success).toBe(false);
  });
});

describe("muggle-remote-test-state-create", () => {
  it("posts the state with its facts and check", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-state-create", STATE_CREATE_INPUT);

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(`${PROJECT_PATH}/test-states`);
    expect(upstreamCall.body).toEqual({
      name: "Message unread",
      facts: [
        { statement: "the patient has one booked appointment", scope: "ACCOUNT_SET", roleId: null },
        { statement: "the doctor's unread count is one", scope: "ACCOUNT", roleId: ROLE_ID },
      ],
      check: "the thread shows one unread message",
    });
  });

  it("sends only the name when facts and check are omitted, and accepts an empty check", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-state-create", { projectId: PROJECT_ID, name: "Booked" });

    expect(upstreamCall.body).toEqual({ name: "Booked" });
    expect(TestStateCreateInputSchema.safeParse({ ...STATE_CREATE_INPUT, check: "" }).success).toBe(true);
  });

  it.each([
    ["a blank name", { ...STATE_CREATE_INPUT, name: "" }],
    ["an unknown fact scope", { ...STATE_CREATE_INPUT, facts: [{ ...ACCOUNT_SET_FACT, scope: "GLOBAL" }] }],
    ["a fact without roleId", { ...STATE_CREATE_INPUT, facts: [{ statement: "inbox empty", scope: "ACCOUNT_SET" }] }],
    ["a blank fact statement", { ...STATE_CREATE_INPUT, facts: [{ ...ACCOUNT_SET_FACT, statement: "" }] }],
    ["a fact roleId that is not a UUID", { ...STATE_CREATE_INPUT, facts: [{ ...ACCOUNT_FACT, roleId: "Doctor" }] }],
    ["a projectId that is not a UUID", { ...STATE_CREATE_INPUT, projectId: "PRJ-1" }],
  ])("rejects %s", (_caseName, toolInput) => {
    expect(TestStateCreateInputSchema.safeParse(toolInput).success).toBe(false);
  });
});

describe("muggle-remote-test-state-update", () => {
  it("puts only the provided changes to the state's path", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-state-update", {
      projectId: PROJECT_ID,
      stateId: STATE_ID,
      facts: [ACCOUNT_SET_FACT],
    });

    expect(upstreamCall.method).toBe("PUT");
    expect(upstreamCall.path).toBe(`${PROJECT_PATH}/test-states/${STATE_ID}`);
    expect(upstreamCall.body).toEqual({ facts: [ACCOUNT_SET_FACT] });
  });

  it("requires a state UUID", () => {
    expect(TestStateUpdateInputSchema.safeParse({ projectId: PROJECT_ID, name: "Booked" }).success).toBe(false);
    expect(TestStateUpdateInputSchema.safeParse({ projectId: PROJECT_ID, stateId: "Booked" }).success).toBe(false);
  });
});

describe("test state and role delete", () => {
  it.each([
    ["muggle-remote-test-state-delete", "stateId", STATE_ID, `${PROJECT_PATH}/test-states/${STATE_ID}`],
    ["muggle-remote-test-role-delete", "roleId", ROLE_ID, `${PROJECT_PATH}/test-roles/${ROLE_ID}`],
  ])("%s issues DELETE to the entity's path", (toolName, idField, entityId, expectedPath) => {
    const upstreamCall = mapToolInput(toolName, { projectId: PROJECT_ID, [idField]: entityId });

    expect(upstreamCall.method).toBe("DELETE");
    expect(upstreamCall.path).toBe(expectedPath);
    expect(upstreamCall.body).toBeUndefined();
  });

  it.each([
    ["muggle-remote-test-state-delete", "stateId", STATE_ID],
    ["muggle-remote-test-role-delete", "roleId", ROLE_ID],
  ])("%s confirms the deleted id from an empty 204", (toolName, idField, entityId) => {
    const toolInput = { projectId: PROJECT_ID, [idField]: entityId };
    const toolOutput = getQaToolByName(toolName)!.mapFromUpstream!({ statusCode: 204, data: "", headers: {} }, toolInput);

    expect(toolOutput).toEqual({ [idField]: entityId, isDeleted: true });
  });

  it.each([
    ["muggle-remote-test-state-delete", "stateId"],
    ["muggle-remote-test-role-delete", "roleId"],
  ])("%s requires both a project and an entity UUID", (toolName, idField) => {
    const inputSchema = getQaToolByName(toolName)!.inputSchema;

    expect(inputSchema.safeParse({ projectId: PROJECT_ID }).success).toBe(false);
    expect(inputSchema.safeParse({ projectId: PROJECT_ID, [idField]: "not-a-uuid" }).success).toBe(false);
    expect(inputSchema.safeParse({ [idField]: STATE_ID }).success).toBe(false);
  });
});

describe("muggle-remote-test-role-create", () => {
  it("posts the role with its source and allowsChanges", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-role-create", {
      projectId: PROJECT_ID,
      name: "Doctor",
      source: TestRoleSourceEnum.SUPPLIED,
      allowsChanges: true,
    });

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(`${PROJECT_PATH}/test-roles`);
    expect(upstreamCall.body).toEqual({ name: "Doctor", source: "SUPPLIED", allowsChanges: true });
  });

  it("leaves allowsChanges off the body when omitted", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-role-create", {
      projectId: PROJECT_ID,
      name: "Patient",
      source: TestRoleSourceEnum.CREATED,
    });

    expect(upstreamCall.body).toEqual({ name: "Patient", source: "CREATED" });
  });

  it.each([
    ["a missing source", { projectId: PROJECT_ID, name: "Patient" }],
    ["an unknown source", { projectId: PROJECT_ID, name: "Patient", source: "INVITED" }],
    ["a blank name", { projectId: PROJECT_ID, name: "", source: TestRoleSourceEnum.CREATED }],
  ])("rejects %s", (_caseName, toolInput) => {
    expect(TestRoleCreateInputSchema.safeParse(toolInput).success).toBe(false);
  });
});

describe("muggle-remote-test-role-update", () => {
  it("puts only the provided changes to the role's path", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-role-update", {
      projectId: PROJECT_ID,
      roleId: ROLE_ID,
      allowsChanges: false,
    });

    expect(upstreamCall.method).toBe("PUT");
    expect(upstreamCall.path).toBe(`${PROJECT_PATH}/test-roles/${ROLE_ID}`);
    expect(upstreamCall.body).toEqual({ allowsChanges: false });
  });
});

describe("muggle-remote-test-state-plan-get", () => {
  it("reads the plan preview for production when asked", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-state-plan-get", { projectId: PROJECT_ID, isProduction: true });

    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe(`${PROJECT_PATH}/test-state-plan`);
    expect(upstreamCall.queryParams).toEqual({ isProduction: true });
    expect(upstreamCall.body).toBeUndefined();
  });

  it("leaves isProduction unset when omitted, so the backend default applies", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-state-plan-get", { projectId: PROJECT_ID });

    expect(upstreamCall.queryParams?.isProduction).toBeUndefined();
  });

  it("tells the caller it is a read-only preview that runs nothing", () => {
    const description = getQaToolByName("muggle-remote-test-state-plan-get")!.description;

    expect(description).toContain("Read-only");
    expect(description).toContain("does not run anything");
  });
});

describe("test case test state fields", () => {
  it("create carries the roles and states when given", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-case-create", {
      ...TEST_CASE_CREATE_INPUT,
      actsAsRoleIds: [ROLE_ID],
      prerequisiteStateId: STATE_ID,
      resultStateId: RESULT_STATE_ID,
    });

    expect(upstreamCall.body).toMatchObject({
      actsAsRoleIds: [ROLE_ID],
      prerequisiteStateId: STATE_ID,
      resultStateId: RESULT_STATE_ID,
    });
  });

  it("create omits all three keys when not given", () => {
    const body = mapToolInput("muggle-remote-test-case-create", TEST_CASE_CREATE_INPUT).body as Record<string, unknown>;

    expect("actsAsRoleIds" in body).toBe(false);
    expect("prerequisiteStateId" in body).toBe(false);
    expect("resultStateId" in body).toBe(false);
  });

  it("update sends null to clear each field", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-case-update", {
      testCaseId: TEST_CASE_ID,
      actsAsRoleIds: null,
      prerequisiteStateId: null,
      resultStateId: null,
    });

    expect(upstreamCall.body).toEqual({
      id: TEST_CASE_ID,
      actsAsRoleIds: null,
      prerequisiteStateId: null,
      resultStateId: null,
    });
  });

  it("update writes none of the keys when all are omitted", () => {
    const upstreamCall = mapToolInput("muggle-remote-test-case-update", { testCaseId: TEST_CASE_ID, title: "Renamed" });

    expect(upstreamCall.body).toEqual({ id: TEST_CASE_ID, title: "Renamed" });
  });

  it.each(["muggle-remote-test-case-create", "muggle-remote-test-case-update"])(
    "%s rejects an id that is not a UUID",
    (toolName) => {
      const inputSchema = getQaToolByName(toolName)!.inputSchema;
      const baseInput = toolName === "muggle-remote-test-case-create" ? TEST_CASE_CREATE_INPUT : { testCaseId: TEST_CASE_ID };

      expect(inputSchema.safeParse({ ...baseInput, actsAsRoleIds: ["Patient"] }).success).toBe(false);
      expect(inputSchema.safeParse({ ...baseInput, prerequisiteStateId: "Booked" }).success).toBe(false);
      expect(inputSchema.safeParse({ ...baseInput, resultStateId: "Booked" }).success).toBe(false);
    },
  );
});

describe("test state backend errors", () => {
  it("relays a 409 { error } message from a delete still in use", async () => {
    const backendMessage = "Test state is still used by 2 test cases";
    answerUpstreamWith(409, { error: backendMessage });

    const toolResult = await executeQaTool(
      "muggle-remote-test-state-delete",
      { projectId: PROJECT_ID, stateId: STATE_ID },
      "correlation-1",
    );

    expect(toolResult.isError).toBe(true);
    expect(JSON.parse(toolResult.content)).toEqual({
      error: McpErrorCode.INVALID_ARGUMENT,
      message: backendMessage,
    });
  });
});
