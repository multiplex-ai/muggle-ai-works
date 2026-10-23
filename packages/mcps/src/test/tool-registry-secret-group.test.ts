/**
 * Tests for the typed secret tools on the cloud E2E registry.
 *
 * Covers:
 *   - each tool's input schema and the upstream verb, path and body it maps to
 *   - create and update pointing the caller at the served secret type catalogue
 *   - secret group responses mapped to metadata, with no secret value surviving
 *   - backend 400/409 `{ error }` messages reaching the caller unchanged
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
  EmptyInputSchema,
  SecretFieldEnum,
  SecretGroupCreateInputSchema,
  SecretGroupListInputSchema,
  SecretGroupUpdateInputSchema,
  SecretTypeEnum,
} from "../mcp/e2e/contracts/index.js";
import { McpErrorCode } from "../mcp/e2e/types.js";
import { PromptServiceClient } from "../mcp/e2e/upstream-client.js";
import { executeQaTool, getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const CARD_NUMBER_SECRET_ID = "33333333-3333-4333-8333-333333333333";
const CVC_SECRET_ID = "44444444-4444-4444-8444-444444444444";
const ADHOC_SECRET_ID = "55555555-5555-4555-8555-555555555555";
const SECRET_GROUPS_PATH = "/v1/protected/muggle-test/secret-groups";
const CARD_NUMBER = "4242 4242 4242 4242";
const ADHOC_TOKEN = "staging-api-token-value";
const CARD_FIELD_VALUES = {
  [SecretFieldEnum.CARD_NUMBER]: CARD_NUMBER,
  [SecretFieldEnum.EXPIRY]: "12/34",
  [SecretFieldEnum.CVC]: "123",
};
const CARD_CREATE_INPUT = {
  projectId: PROJECT_ID,
  secretType: SecretTypeEnum.PAYMENT_CARD,
  groupName: "Visa test",
  fields: CARD_FIELD_VALUES,
};
const CARD_GROUP = {
  id: GROUP_ID,
  projectId: PROJECT_ID,
  secretType: SecretTypeEnum.PAYMENT_CARD,
  groupName: "Visa test",
  description: "",
};
// Upstream bodies still carry values and soft-delete fields, so the tests prove the mapping drops them.
const CARD_GROUP_SUMMARY = {
  group: { ...CARD_GROUP, isDeleted: false },
  members: [
    {
      field: SecretFieldEnum.CARD_NUMBER,
      secret: {
        id: CARD_NUMBER_SECRET_ID,
        projectId: PROJECT_ID,
        secretName: "visa_test_card_number",
        value: CARD_NUMBER,
        groupId: GROUP_ID,
        field: SecretFieldEnum.CARD_NUMBER,
        isDeleted: false,
      },
    },
    {
      field: SecretFieldEnum.CVC,
      secret: {
        id: CVC_SECRET_ID,
        projectId: PROJECT_ID,
        secretName: "visa_test_cvc",
        value: "123",
        groupId: GROUP_ID,
        field: SecretFieldEnum.CVC,
      },
    },
  ],
};
const SECRET_GROUP_LISTING = {
  groups: [CARD_GROUP_SUMMARY],
  adhocSecrets: [
    {
      id: ADHOC_SECRET_ID,
      projectId: PROJECT_ID,
      secretName: "staging_api_token",
      value: ADHOC_TOKEN,
      description: "Staging API token",
      source: "user",
    },
  ],
};
const EXPECTED_CARD_GROUP_SUMMARY = {
  group: CARD_GROUP,
  members: [
    {
      field: "card_number",
      secret: {
        id: CARD_NUMBER_SECRET_ID,
        projectId: PROJECT_ID,
        secretName: "visa_test_card_number",
        groupId: GROUP_ID,
        field: "card_number",
      },
    },
    {
      field: "cvc",
      secret: { id: CVC_SECRET_ID, projectId: PROJECT_ID, secretName: "visa_test_cvc", groupId: GROUP_ID, field: "cvc" },
    },
  ],
};

function collectPropertyNames(responsePart: unknown): string[] {
  if (Array.isArray(responsePart)) {
    return responsePart.flatMap(collectPropertyNames);
  }
  if (responsePart !== null && typeof responsePart === "object") {
    return Object.entries(responsePart).flatMap(([propertyName, propertyContent]) => [
      propertyName,
      ...collectPropertyNames(propertyContent),
    ]);
  }
  return [];
}

function answerUpstreamWith(statusCode: number, responseBody: unknown): void {
  const promptServiceClient = new PromptServiceClient();
  // The instance builds its own axios client; answer every request with the given backend response.
  (promptServiceClient as unknown as { httpClient: { request: () => Promise<unknown> } }).httpClient = {
    request: () => Promise.resolve({ status: statusCode, data: responseBody, headers: {} }),
  };
  upstreamClientHolder.promptServiceClient = promptServiceClient;
}

describe("muggle-remote-secret-type-list", () => {
  it("reads the served secret type catalogue without input", () => {
    const tool = getQaToolByName("muggle-remote-secret-type-list")!;
    const upstreamCall = tool.mapToUpstream({});

    expect(tool.inputSchema).toBe(EmptyInputSchema);
    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe("/v1/protected/muggle-test/secret-types");
    expect(upstreamCall.queryParams).toBeUndefined();
    expect(upstreamCall.body).toBeUndefined();
  });
});

describe("muggle-remote-secret-group-create", () => {
  it("posts the group with its field values", () => {
    const upstreamCall = getQaToolByName("muggle-remote-secret-group-create")!.mapToUpstream({
      ...CARD_CREATE_INPUT,
      description: "Checkout card",
    });

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(SECRET_GROUPS_PATH);
    expect(upstreamCall.body).toEqual({
      projectId: PROJECT_ID,
      secretType: "payment_card",
      groupName: "Visa test",
      description: "Checkout card",
      fields: { card_number: CARD_NUMBER, expiry: "12/34", cvc: "123" },
    });
  });

  it("accepts a subset of the known fields", () => {
    expect(SecretGroupCreateInputSchema.safeParse(CARD_CREATE_INPUT).success).toBe(true);
  });

  it.each([
    ["an unknown field", { ...CARD_CREATE_INPUT, fields: { ...CARD_FIELD_VALUES, pin: "0000" } }],
    ["a non-string value", { ...CARD_CREATE_INPUT, fields: { ...CARD_FIELD_VALUES, cvc: 123 } }],
    ["an unknown secretType", { ...CARD_CREATE_INPUT, secretType: "bank_account" }],
    ["a blank groupName", { ...CARD_CREATE_INPUT, groupName: "" }],
    ["a missing fields map", { projectId: PROJECT_ID, secretType: SecretTypeEnum.PAYMENT_CARD, groupName: "Visa test" }],
    ["a projectId that is not a UUID", { ...CARD_CREATE_INPUT, projectId: "PRJ-1" }],
  ])("rejects %s", (_caseName, toolInput) => {
    expect(SecretGroupCreateInputSchema.safeParse(toolInput).success).toBe(false);
  });
});

describe("muggle-remote-secret-group-list", () => {
  it("reads the project's groups by projectId", () => {
    const upstreamCall = getQaToolByName("muggle-remote-secret-group-list")!.mapToUpstream({ projectId: PROJECT_ID });

    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe(SECRET_GROUPS_PATH);
    expect(upstreamCall.queryParams).toEqual({ projectId: PROJECT_ID });
    expect(upstreamCall.body).toBeUndefined();
  });

  it("requires a project UUID", () => {
    expect(SecretGroupListInputSchema.safeParse({}).success).toBe(false);
    expect(SecretGroupListInputSchema.safeParse({ projectId: "PRJ-1" }).success).toBe(false);
  });
});

describe("muggle-remote-secret-group-update", () => {
  it("puts only the provided changes, keeping an empty string that clears a field", () => {
    const changedFieldValues = {
      [SecretFieldEnum.CVC]: "456",
      [SecretFieldEnum.BILLING_POSTAL_CODE]: "",
    };
    const upstreamCall = getQaToolByName("muggle-remote-secret-group-update")!.mapToUpstream({
      groupId: GROUP_ID,
      fields: changedFieldValues,
    });

    expect(upstreamCall.method).toBe("PUT");
    expect(upstreamCall.path).toBe(`${SECRET_GROUPS_PATH}/${GROUP_ID}`);
    expect(upstreamCall.body).toEqual({ fields: { cvc: "456", billing_postal_code: "" } });
    expect(upstreamCall.body).not.toHaveProperty("description");
  });

  it("sends a description-only change without a fields map", () => {
    const upstreamCall = getQaToolByName("muggle-remote-secret-group-update")!.mapToUpstream({
      groupId: GROUP_ID,
      description: "Expired card",
    });

    expect(upstreamCall.body).toEqual({ description: "Expired card" });
  });

  it("accepts an empty string for a field and rejects an unknown field or malformed groupId", () => {
    const clearPostalCodeInput = { groupId: GROUP_ID, fields: { [SecretFieldEnum.BILLING_POSTAL_CODE]: "" } };

    expect(SecretGroupUpdateInputSchema.safeParse(clearPostalCodeInput).success).toBe(true);
    expect(SecretGroupUpdateInputSchema.safeParse({ groupId: GROUP_ID, fields: { pin: "0000" } }).success).toBe(false);
    expect(SecretGroupUpdateInputSchema.safeParse({ groupId: "group-1" }).success).toBe(false);
  });
});

describe("secret group field guidance", () => {
  it.each(["muggle-remote-secret-group-create", "muggle-remote-secret-group-update"])(
    "%s sends the caller to the served type catalogue",
    (toolName) => {
      expect(getQaToolByName(toolName)!.description).toContain("muggle-remote-secret-type-list");
    },
  );
});

describe("secret group responses", () => {
  it.each([
    ["muggle-remote-secret-group-list", SECRET_GROUP_LISTING],
    ["muggle-remote-secret-group-create", CARD_GROUP_SUMMARY],
    ["muggle-remote-secret-group-update", CARD_GROUP_SUMMARY],
    ["muggle-remote-secret-group-delete", CARD_GROUP_SUMMARY],
  ])("%s returns no secret value, even when upstream sends one", (toolName, responseBody) => {
    const toolOutput = getQaToolByName(toolName)!.mapFromUpstream!({ statusCode: 200, data: responseBody, headers: {} });

    expect(collectPropertyNames(toolOutput)).not.toContain("value");
    expect(JSON.stringify(toolOutput)).not.toContain(CARD_NUMBER);
  });

  it("maps the listing to group and secret metadata", () => {
    const toolOutput = getQaToolByName("muggle-remote-secret-group-list")!.mapFromUpstream!({
      statusCode: 200,
      data: SECRET_GROUP_LISTING,
      headers: {},
    });

    expect(toolOutput).toEqual({
      groups: [EXPECTED_CARD_GROUP_SUMMARY],
      adhocSecrets: [
        {
          id: ADHOC_SECRET_ID,
          projectId: PROJECT_ID,
          secretName: "staging_api_token",
          description: "Staging API token",
          source: "user",
        },
      ],
    });
  });

  it.each(["muggle-remote-secret-group-create", "muggle-remote-secret-group-update", "muggle-remote-secret-group-delete"])(
    "%s maps the group summary to metadata",
    (toolName) => {
      const toolOutput = getQaToolByName(toolName)!.mapFromUpstream!({
        statusCode: 200,
        data: CARD_GROUP_SUMMARY,
        headers: {},
      });

      expect(toolOutput).toEqual(EXPECTED_CARD_GROUP_SUMMARY);
    },
  );

  it.each([
    ["muggle-remote-secret-group-list", CARD_GROUP_SUMMARY],
    ["muggle-remote-secret-group-list", []],
    ["muggle-remote-secret-group-create", SECRET_GROUP_LISTING],
    ["muggle-remote-secret-group-update", [CARD_GROUP_SUMMARY]],
    ["muggle-remote-secret-group-delete", null],
  ])("%s fails as an upstream error on an unexpected body", (toolName, responseBody) => {
    const mapFromUpstream = getQaToolByName(toolName)!.mapFromUpstream!;

    expect(() => mapFromUpstream({ statusCode: 200, data: responseBody, headers: {} })).toThrow(
      expect.objectContaining({ code: McpErrorCode.UPSTREAM_ERROR }),
    );
  });

  it("keeps the values out of the tool result the caller receives", async () => {
    answerUpstreamWith(200, SECRET_GROUP_LISTING);

    const toolResult = await executeQaTool("muggle-remote-secret-group-list", { projectId: PROJECT_ID }, "correlation-1");

    expect(toolResult.isError).toBe(false);
    expect(toolResult.content).not.toContain(CARD_NUMBER);
    expect(toolResult.content).not.toContain(ADHOC_TOKEN);
    expect(collectPropertyNames(JSON.parse(toolResult.content))).not.toContain("value");
  });
});

describe("secret group backend errors", () => {
  it.each([
    [400, "Card number must pass the Luhn check"],
    [409, "A secret named visa_test_card_number already exists"],
  ])("relays a %i { error } message to the caller", async (statusCode, backendMessage) => {
    answerUpstreamWith(statusCode, { error: backendMessage });

    const toolResult = await executeQaTool("muggle-remote-secret-group-create", CARD_CREATE_INPUT, "correlation-1");

    expect(toolResult.isError).toBe(true);
    expect(JSON.parse(toolResult.content)).toEqual({
      error: McpErrorCode.INVALID_ARGUMENT,
      message: backendMessage,
    });
  });
});
