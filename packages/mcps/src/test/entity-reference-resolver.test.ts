/**
 * Tests for resolving project short IDs (TC-42) in cloud E2E tool inputs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZodObject, ZodRawShape } from "zod";

const executeUpstreamCall = vi.hoisted(() => vi.fn());
const readLastProjectEntry = vi.hoisted(() => vi.fn());

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

vi.mock("../mcp/e2e/upstream-client.js", () => ({
  getPromptServiceClient: () => ({ execute: executeUpstreamCall }),
}));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

// The server cannot know the caller's working directory, so a cached last project never stands in for projectId.
vi.mock("../shared/last-project.js", () => ({
  readLastProject: readLastProjectEntry,
}));

import { EntityReferenceSchema } from "../mcp/contracts/entity-reference-schema.js";
import { GatewayError, McpErrorCode, type IQaToolDefinition } from "../mcp/e2e/types.js";
import { resolveEntityReferencesAsync } from "../mcp/tools/e2e/entity-reference-resolver.js";
import { ShortIdEntityTypeEnum } from "../mcp/contracts/entity-reference-types.js";
import type { IShortIdResolution } from "../mcp/tools/e2e/entity-reference-resolver-types.js";
import { allQaToolDefinitions, executeQaTool, getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const LAST_PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const TEST_CASE_ID = "33333333-3333-4333-8333-333333333333";
const MISTYPED_TEST_CASE_ID = "33333333-3333-4333-8333-33333333333";
const TEST_SCRIPT_ID = "44444444-4444-4444-8444-444444444444";
const REPLAY_RUN_ID = "55555555-5555-4555-8555-555555555555";
const REPLAY_RUNTIME_ID = "66666666-6666-4666-8666-666666666666";
const CREDENTIALS = { bearerToken: "test-token" };
const CORRELATION_ID = "correlation-1";
const SHORT_ID_ROUTE = `/v1/protected/muggle-test/projects/${PROJECT_ID}/short-ids/`;
const INVALID_REFERENCE_MESSAGE = "Expected a full ID or a short ID such as TC-42";

const TEST_CASE_RESOLUTION: IShortIdResolution = {
  entityType: ShortIdEntityTypeEnum.TEST_CASE,
  shortId: "TC-42",
  entityId: TEST_CASE_ID,
  isDeleted: false,
  useCaseId: "22222222-2222-4222-8222-222222222222",
};

const REPLAY_RESOLUTION: IShortIdResolution = {
  entityType: ShortIdEntityTypeEnum.REPLAY,
  shortId: "R-2051",
  entityId: REPLAY_RUN_ID,
  isDeleted: false,
  testScriptId: TEST_SCRIPT_ID,
  workflowRuntimeId: REPLAY_RUNTIME_ID,
};

const USE_CASE_RESOLUTION: IShortIdResolution = {
  entityType: ShortIdEntityTypeEnum.USE_CASE,
  shortId: "UC-7",
  entityId: "77777777-7777-4777-8777-777777777777",
  isDeleted: false,
};

const TOOLS_TAKING_SHORT_IDS = [
  "muggle-remote-test-case-get",
  "muggle-remote-test-case-list-by-use-case",
  "muggle-remote-test-script-get",
  "muggle-remote-use-case-get",
  "muggle-remote-wf-get-ts-replay-latest-run",
  "muggle-remote-workflow-start-test-script-replay",
];

/** Answer every upstream call with one short-ID resolution. */
function answerResolution (resolution: IShortIdResolution): void {
  executeUpstreamCall.mockResolvedValue({ statusCode: 200, data: resolution, headers: {} });
}

/** Run the resolver over an input with the reference fields a registered tool declares. */
function resolveForTool (toolName: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return resolveEntityReferencesAsync({
    entityReferenceFields: getQaToolByName(toolName)!.entityReferenceFields ?? [],
    input: input,
    credentials: CREDENTIALS,
    correlationId: CORRELATION_ID,
  });
}

function resolveTestCaseGet (input: Record<string, unknown>): Promise<Record<string, unknown>> {
  return resolveForTool("muggle-remote-test-case-get", input);
}

/** The top-level input fields of a tool, or none when its schema is not an object. */
function inputShapeOf (tool: IQaToolDefinition): ZodRawShape {
  return (tool.inputSchema as Partial<ZodObject<ZodRawShape>>).shape ?? {};
}

beforeEach(() => {
  executeUpstreamCall.mockReset();
  readLastProjectEntry.mockReset();
  readLastProjectEntry.mockReturnValue({
    projectId: LAST_PROJECT_ID,
    projectUrl: "https://example.com",
    projectName: "Example",
    savedAt: "2026-10-22T00:00:00.000Z",
  });
});

describe("resolveEntityReferencesAsync", () => {
  it("passes a full ID through untouched without calling upstream", async () => {
    const resolvedInput = await resolveTestCaseGet({ testCaseId: TEST_CASE_ID });

    expect(resolvedInput).toEqual({ testCaseId: TEST_CASE_ID });
    expect(executeUpstreamCall).not.toHaveBeenCalled();
  });

  it("replaces a short test case ID with the resolved entity ID", async () => {
    answerResolution(TEST_CASE_RESOLUTION);

    const resolvedInput = await resolveTestCaseGet({ testCaseId: "TC-42", projectId: PROJECT_ID });

    expect(resolvedInput).toEqual({ testCaseId: TEST_CASE_ID, projectId: PROJECT_ID });
    expect(executeUpstreamCall).toHaveBeenCalledTimes(1);
    expect(executeUpstreamCall.mock.calls[0][0]).toEqual({ method: "GET", path: `${SHORT_ID_ROUTE}TC-42` });
    expect(executeUpstreamCall.mock.calls[0][1]).toEqual(CREDENTIALS);
    expect(executeUpstreamCall.mock.calls[0][2]).toBe(CORRELATION_ID);
  });

  it("encodes a short ID typed with a space into the route", async () => {
    answerResolution(TEST_CASE_RESOLUTION);

    await resolveTestCaseGet({ testCaseId: "tc 42", projectId: PROJECT_ID });

    expect(executeUpstreamCall.mock.calls[0][0].path).toBe(`${SHORT_ID_ROUTE}tc%2042`);
  });

  it("replaces a replay short ID with the replay's workflow runtime ID", async () => {
    answerResolution(REPLAY_RESOLUTION);

    const resolvedInput = await resolveForTool(
      "muggle-remote-wf-get-ts-replay-latest-run",
      { workflowRuntimeId: "R-2051", projectId: PROJECT_ID },
    );

    expect(resolvedInput.workflowRuntimeId).toBe(REPLAY_RUNTIME_ID);
  });

  it("rejects a short ID of the wrong type instead of fetching the wrong entity", async () => {
    answerResolution(USE_CASE_RESOLUTION);

    await expect(resolveTestCaseGet({ testCaseId: "UC-7", projectId: PROJECT_ID }))
      .rejects.toThrow("UC-7 is a use case, not a test case");
  });

  it("names both entity types for every wrong-type pairing", async () => {
    answerResolution(REPLAY_RESOLUTION);

    await expect(resolveForTool("muggle-remote-test-script-get", { testScriptId: "R-2051", projectId: PROJECT_ID }))
      .rejects.toThrow("R-2051 is a replay, not a test script");
  });

  it("reports a short ID whose entity was deleted as deleted", async () => {
    answerResolution({ ...TEST_CASE_RESOLUTION, isDeleted: true });

    await expect(resolveTestCaseGet({ testCaseId: "TC-42", projectId: PROJECT_ID }))
      .rejects.toThrow("TC-42 was deleted");
  });

  it("surfaces the server's not-found message for an unknown short ID", async () => {
    const notFoundMessage = `TC-42 not found in project ${PROJECT_ID}`;
    executeUpstreamCall.mockRejectedValue(new GatewayError({
      code: McpErrorCode.NOT_FOUND,
      message: notFoundMessage,
      statusCode: 404,
    }));

    await expect(resolveTestCaseGet({ testCaseId: "TC-42", projectId: PROJECT_ID }))
      .rejects.toThrow(notFoundMessage);
  });

  it("requires projectId for a short ID even when a last project is cached", async () => {
    await expect(resolveTestCaseGet({ testCaseId: "TC-42" })).rejects.toThrow("Resolving TC-42 needs projectId");
    expect(executeUpstreamCall).not.toHaveBeenCalled();
    expect(readLastProjectEntry).not.toHaveBeenCalled();
  });

  it("leaves the input of a tool without entity references untouched", async () => {
    const input = { projectId: PROJECT_ID, testCaseId: "TC-42" };

    const resolvedInput = await resolveForTool("muggle-remote-test-case-delete", input);

    expect(resolvedInput).toEqual(input);
    expect(executeUpstreamCall).not.toHaveBeenCalled();
  });
});

describe("EntityReferenceSchema", () => {
  it.each(["TC-42", "tc 042", " uc7 ", "TS-118", "r-2051", TEST_CASE_ID])("accepts %j", (reference) => {
    expect(EntityReferenceSchema.safeParse(reference).success).toBe(true);
  });

  it.each(["abc", MISTYPED_TEST_CASE_ID, "TC-0", "XY-1", "TC-", "42"])("rejects %j", (reference) => {
    const parseResult = EntityReferenceSchema.safeParse(reference);
    expect(parseResult.success).toBe(false);
    expect(parseResult.error?.issues[0].message).toBe(INVALID_REFERENCE_MESSAGE);
  });
});

describe("entity reference fields", () => {
  it("declares fields that accept a short ID, beside a projectId that stays a full ID", () => {
    const toolsWithReferences = allQaToolDefinitions.filter((tool) => (tool.entityReferenceFields ?? []).length > 0);
    for (const tool of toolsWithReferences) {
      const inputShape = inputShapeOf(tool);
      expect(inputShape.projectId, `${tool.name} projectId`).toBeDefined();
      expect(inputShape.projectId.safeParse("TC-42").success, `${tool.name} projectId stays a full ID`).toBe(false);
      for (const entityReferenceField of tool.entityReferenceFields!) {
        const fieldSchema = inputShape[entityReferenceField.fieldName];
        expect(fieldSchema, `${tool.name}.${entityReferenceField.fieldName}`).toBeDefined();
        expect(fieldSchema.safeParse("TC-42").success, `${tool.name}.${entityReferenceField.fieldName}`).toBe(true);
        expect(fieldSchema.safeParse(TEST_CASE_ID).success, `${tool.name}.${entityReferenceField.fieldName}`).toBe(true);
      }
    }
  });

  // A field that validates as a short ID but is not declared would reach prompt-service still holding "TC-42".
  it("declares every input field whose schema takes a short ID", () => {
    for (const tool of allQaToolDefinitions) {
      const inputShape = inputShapeOf(tool);
      const shortIdFieldNames = Object.keys(inputShape)
        .filter((fieldName) => inputShape[fieldName].safeParse("TC-42").success && !inputShape[fieldName].safeParse("abc").success);
      const declaredFieldNames = (tool.entityReferenceFields ?? []).map((field) => field.fieldName);
      expect(declaredFieldNames.sort(), tool.name).toEqual(shortIdFieldNames.sort());
    }
  });

  it("covers use case, test case, test script and replay references", () => {
    const toolNames = allQaToolDefinitions
      .filter((tool) => (tool.entityReferenceFields ?? []).length > 0)
      .map((tool) => tool.name);
    expect(toolNames.sort()).toEqual(TOOLS_TAKING_SHORT_IDS);
  });

  it("tells the caller a replay short ID resolves to that replay's runtime", () => {
    const description = getQaToolByName("muggle-remote-wf-get-ts-replay-latest-run")!.description;
    expect(description).toContain("R-2051");
    expect(description).toMatch(/runtime's latest run/);
  });
});

describe("executeQaTool with a short ID", () => {
  it("calls upstream with the resolved full ID", async () => {
    executeUpstreamCall
      .mockResolvedValueOnce({ statusCode: 200, data: TEST_CASE_RESOLUTION, headers: {} })
      .mockResolvedValueOnce({ statusCode: 200, data: { id: TEST_CASE_ID }, headers: {} });

    const toolResult = await executeQaTool(
      "muggle-remote-test-case-get",
      { testCaseId: "TC-42", projectId: PROJECT_ID },
      CORRELATION_ID,
    );

    expect(toolResult.isError).toBe(false);
    expect(executeUpstreamCall).toHaveBeenCalledTimes(2);
    expect(executeUpstreamCall.mock.calls[1][0].path).toBe(`/v1/protected/muggle-test/test-cases/${TEST_CASE_ID}`);
  });

  it("returns the wrong-type message as a tool error and never fetches the entity", async () => {
    answerResolution(USE_CASE_RESOLUTION);

    const toolResult = await executeQaTool(
      "muggle-remote-test-case-get",
      { testCaseId: "UC-7", projectId: PROJECT_ID },
      CORRELATION_ID,
    );

    expect(toolResult.isError).toBe(true);
    expect(JSON.parse(toolResult.content)).toEqual({
      error: McpErrorCode.INVALID_ARGUMENT,
      message: "UC-7 is a use case, not a test case",
    });
    expect(executeUpstreamCall).toHaveBeenCalledTimes(1);
  });

  it("asks for projectId instead of resolving a short ID in a cached project", async () => {
    const toolResult = await executeQaTool("muggle-remote-test-case-get", { testCaseId: "TC-42" }, CORRELATION_ID);

    expect(toolResult.isError).toBe(true);
    expect(JSON.parse(toolResult.content)).toEqual({
      error: McpErrorCode.INVALID_ARGUMENT,
      message: "Resolving TC-42 needs projectId",
    });
    expect(executeUpstreamCall).not.toHaveBeenCalled();
  });

  it.each(["abc", MISTYPED_TEST_CASE_ID])("rejects %j locally without calling upstream", async (reference) => {
    const toolResult = await executeQaTool(
      "muggle-remote-test-case-get",
      { testCaseId: reference, projectId: PROJECT_ID },
      CORRELATION_ID,
    );

    expect(toolResult.isError).toBe(true);
    expect(toolResult.content).toContain(INVALID_REFERENCE_MESSAGE);
    expect(executeUpstreamCall).not.toHaveBeenCalled();
  });

  it("still rejects a projectId that is not a full ID", async () => {
    const toolResult = await executeQaTool(
      "muggle-remote-test-case-get",
      { testCaseId: "TC-42", projectId: "PRJ-1" },
      CORRELATION_ID,
    );

    expect(toolResult.isError).toBe(true);
    expect(executeUpstreamCall).not.toHaveBeenCalled();
  });
});
