/**
 * Tests for the project access tools on the cloud E2E registry.
 *
 * Covers:
 *   - each tool's upstream verb, path, query params and body
 *   - revoke's DELETE body reaching the HTTP request through the real upstream client
 *   - schema rejection of the OWNER role, unknown principal types and malformed emails
 *   - invite and ownership transfer descriptions stating their consequences
 */

import { describe, expect, it, vi } from "vitest";

const upstreamClientHolder = vi.hoisted(() => ({ promptServiceClient: undefined as unknown }));

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

// The real client stays importable so a request can run through it end to end.
vi.mock("../mcp/e2e/upstream-client.js", async (importOriginal) => {
  const actualModule = await importOriginal<typeof import("../mcp/e2e/upstream-client.js")>();
  return { ...actualModule, getPromptServiceClient: () => upstreamClientHolder.promptServiceClient };
});

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import {
  ProjectAccessGrantInputSchema,
  ProjectAccessPrincipalTypeEnum,
  ProjectAccessRoleEnum,
  ProjectInviteInputSchema,
} from "../mcp/e2e/contracts/index.js";
import { PromptServiceClient } from "../mcp/e2e/upstream-client.js";
import { executeQaTool, getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "auth0|6650f0c2a1b2c3d4e5f60718";
const ACCESS_PATH = `/v1/protected/muggle-test/projects/${PROJECT_ID}/access`;

interface ICapturedRequest {
  method: string;
  url: string;
  data?: unknown;
  headers?: Record<string, string>;
}

function mapToolInput(toolName: string, toolInput: Record<string, unknown>) {
  const tool = getQaToolByName(toolName)!;
  return tool.mapToUpstream(tool.inputSchema.parse(toolInput));
}

function captureUpstreamRequests(statusCode: number, responseBody: unknown): ICapturedRequest[] {
  const capturedRequests: ICapturedRequest[] = [];
  const promptServiceClient = new PromptServiceClient();
  // The instance builds its own axios client; record each request and answer it with the given response.
  (promptServiceClient as unknown as { httpClient: { request: (config: ICapturedRequest) => Promise<unknown> } }).httpClient = {
    request: (config) => {
      capturedRequests.push(config);
      return Promise.resolve({ status: statusCode, data: responseBody, headers: {} });
    },
  };
  upstreamClientHolder.promptServiceClient = promptServiceClient;
  return capturedRequests;
}

describe("muggle-remote-project-access-list and -grant", () => {
  it("lists the project's access", () => {
    const upstreamCall = mapToolInput("muggle-remote-project-access-list", { projectId: PROJECT_ID });

    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe(ACCESS_PATH);
  });

  it("posts the principal and role", () => {
    const upstreamCall = mapToolInput("muggle-remote-project-access-grant", {
      projectId: PROJECT_ID,
      principalType: ProjectAccessPrincipalTypeEnum.User,
      principalId: USER_ID,
      role: ProjectAccessRoleEnum.Editor,
    });

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(ACCESS_PATH);
    expect(upstreamCall.body).toEqual({ principalType: "USER", principalId: USER_ID, role: "EDITOR" });
  });

  it.each([
    ["the OWNER role", { role: "OWNER" }],
    ["an unknown principal type", { principalType: "ORGANIZATION" }],
    ["a blank principal id", { principalId: "" }],
  ])("rejects %s", (_caseName, overrides) => {
    const toolInput = { projectId: PROJECT_ID, principalType: "USER", principalId: USER_ID, role: "VIEWER", ...overrides };

    expect(ProjectAccessGrantInputSchema.safeParse(toolInput).success).toBe(false);
  });
});

describe("muggle-remote-project-access-revoke", () => {
  it("deletes with the principal in the body and reports it revoked", () => {
    const tool = getQaToolByName("muggle-remote-project-access-revoke")!;
    const toolInput = tool.inputSchema.parse({ projectId: PROJECT_ID, principalType: "TEAM", principalId: "team-7" });
    const upstreamCall = tool.mapToUpstream(toolInput);

    expect(upstreamCall.method).toBe("DELETE");
    expect(upstreamCall.path).toBe(ACCESS_PATH);
    expect(upstreamCall.body).toEqual({ principalType: "TEAM", principalId: "team-7" });
    expect(tool.mapFromUpstream!({ statusCode: 204, data: "", headers: {} }, toolInput)).toEqual({
      projectId: PROJECT_ID,
      principalType: "TEAM",
      principalId: "team-7",
      isRevoked: true,
    });
  });

  it("sends the DELETE body as JSON through the upstream client", async () => {
    const capturedRequests = captureUpstreamRequests(204, "");

    const toolResult = await executeQaTool(
      "muggle-remote-project-access-revoke",
      { projectId: PROJECT_ID, principalType: "USER", principalId: USER_ID },
      "correlation-1",
    );

    expect(toolResult.isError).toBe(false);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].method).toBe("DELETE");
    expect(capturedRequests[0].data).toEqual({ principalType: "USER", principalId: USER_ID });
    expect(capturedRequests[0].headers?.["Content-Type"]).toBe("application/json");
  });
});

describe("muggle-remote-project-invite and -invitation-list", () => {
  it("posts the email and role", () => {
    const upstreamCall = mapToolInput("muggle-remote-project-invite", {
      projectId: PROJECT_ID,
      email: "qa@example.com",
      role: ProjectAccessRoleEnum.Viewer,
    });

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(`${ACCESS_PATH}/invite`);
    expect(upstreamCall.body).toEqual({ email: "qa@example.com", role: "VIEWER" });
  });

  it("warns that inviting sends an email", () => {
    expect(getQaToolByName("muggle-remote-project-invite")!.description).toContain("SENDS AN EMAIL");
  });

  it.each([
    ["a malformed email", { email: "qa-at-example.com", role: "VIEWER" }],
    ["the OWNER role", { email: "qa@example.com", role: "OWNER" }],
  ])("rejects %s", (_caseName, overrides) => {
    expect(ProjectInviteInputSchema.safeParse({ projectId: PROJECT_ID, ...overrides }).success).toBe(false);
  });

  it("lists invitations paginated, with pagination defaults applied", () => {
    const upstreamCall = mapToolInput("muggle-remote-project-invitation-list", { projectId: PROJECT_ID, pageSize: 25 });

    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe(`${ACCESS_PATH}/invitations`);
    expect(upstreamCall.queryParams).toEqual({
      paginated: true,
      page: 1,
      pageSize: 25,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
  });
});

describe("muggle-remote-project-ownership-transfer", () => {
  it("posts the new owner and reports the transfer", () => {
    const tool = getQaToolByName("muggle-remote-project-ownership-transfer")!;
    const toolInput = tool.inputSchema.parse({ projectId: PROJECT_ID, newOwnerUserId: USER_ID });
    const upstreamCall = tool.mapToUpstream(toolInput);

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(`/v1/protected/muggle-test/projects/${PROJECT_ID}/transfer-ownership`);
    expect(upstreamCall.body).toEqual({ newOwnerUserId: USER_ID });
    expect(tool.mapFromUpstream!({ statusCode: 204, data: "", headers: {} }, toolInput)).toEqual({
      projectId: PROJECT_ID,
      newOwnerUserId: USER_ID,
      isTransferred: true,
    });
  });

  it("states the consequence and asks to confirm", () => {
    const toolDescription = getQaToolByName("muggle-remote-project-ownership-transfer")!.description;

    expect(toolDescription).toContain("becomes a MAINTAINER");
    expect(toolDescription).toContain("Confirm with the user first");
  });
});
