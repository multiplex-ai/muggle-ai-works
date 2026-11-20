/**
 * Tests for the run settings write tools on the cloud E2E registry.
 *
 * Covers:
 *   - bump posting only the provided fields to the lane's run-settings bump route
 *   - managed profile regenerate and field-set routes, lane and requesting run query params
 *   - schema rejection of unknown profile fields, non-UUID secret ids and an empty bump
 */

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
  const fakeLogger = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fakeLogger };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import {
  ManagedProfileFieldEnum,
  ManagedProfileFieldSetInputSchema,
  RunSettingsBumpInputSchema,
} from "../mcp/e2e/contracts/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const SECRET_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_RESOURCES_ID = "33333333-3333-4333-8333-333333333333";
const WORKFLOW_RUN_ID = "44444444-4444-4444-8444-444444444444";
const RUN_SETTINGS_PATH = `/v1/protected/muggle-test/projects/${PROJECT_ID}/run-settings`;

function mapToolInput(toolName: string, toolInput: Record<string, unknown>) {
  const tool = getQaToolByName(toolName)!;
  return tool.mapToUpstream(tool.inputSchema.parse(toolInput));
}

describe("muggle-remote-run-settings-bump", () => {
  it("posts only the provided fields to the remote lane by default", () => {
    const upstreamCall = mapToolInput("muggle-remote-run-settings-bump", {
      projectId: PROJECT_ID,
      managedProfile: { [ManagedProfileFieldEnum.Password]: SECRET_ID },
    });

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(`${RUN_SETTINGS_PATH}/bump`);
    expect(upstreamCall.queryParams).toEqual({ type: "remote" });
    expect(upstreamCall.body).toEqual({ managedProfile: { managed_profile_password: SECRET_ID } });
  });

  it("sends whole secret and workflow file lists on the local lane", () => {
    const upstreamCall = mapToolInput("muggle-remote-run-settings-bump", {
      projectId: PROJECT_ID,
      runEnvironmentType: "local",
      userSecrets: [SECRET_ID],
      workflowFiles: [],
    });

    expect(upstreamCall.queryParams).toEqual({ type: "local" });
    expect(upstreamCall.body).toEqual({ userSecrets: [SECRET_ID], workflowFiles: [] });
  });

  it.each([
    ["no field", { projectId: PROJECT_ID }],
    ["an unknown profile field", { projectId: PROJECT_ID, managedProfile: { email: SECRET_ID } }],
    ["a user secret that is not a UUID", { projectId: PROJECT_ID, userSecrets: ["api_token"] }],
  ])("rejects %s", (_caseName, toolInput) => {
    expect(RunSettingsBumpInputSchema.safeParse(toolInput).success).toBe(false);
  });
});

describe("muggle-remote-managed-profile-regenerate", () => {
  it("posts to the regenerate route with the lane and requesting run", () => {
    const upstreamCall = mapToolInput("muggle-remote-managed-profile-regenerate", {
      projectId: PROJECT_ID,
      workflowRunId: WORKFLOW_RUN_ID,
    });

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(`${RUN_SETTINGS_PATH}/regenerate-profile`);
    expect(upstreamCall.queryParams).toEqual({ type: "remote", workflowRunId: WORKFLOW_RUN_ID });
    expect(upstreamCall.body).toBeUndefined();
  });

  it("asks the caller to confirm before replacing the identity", () => {
    expect(getQaToolByName("muggle-remote-managed-profile-regenerate")!.description).toContain("confirm with the user first");
  });
});

describe("muggle-remote-managed-profile-field-set", () => {
  it("posts the field, its secret and the base version", () => {
    const upstreamCall = mapToolInput("muggle-remote-managed-profile-field-set", {
      projectId: PROJECT_ID,
      runEnvironmentType: "local",
      baseProjectResourcesId: PROJECT_RESOURCES_ID,
      fieldName: ManagedProfileFieldEnum.TotpSecret,
      secretId: SECRET_ID,
    });

    expect(upstreamCall.method).toBe("POST");
    expect(upstreamCall.path).toBe(`${RUN_SETTINGS_PATH}/managed-profile-field`);
    expect(upstreamCall.queryParams).toEqual({ type: "local", workflowRunId: undefined });
    expect(upstreamCall.body).toEqual({
      baseProjectResourcesId: PROJECT_RESOURCES_ID,
      fieldName: "managed_profile_totp_secret",
      secretId: SECRET_ID,
    });
  });

  it.each([
    ["an unknown field name", { fieldName: "phone" }],
    ["a missing base version", { baseProjectResourcesId: undefined }],
    ["a secret id that is not a UUID", { secretId: "totp" }],
  ])("rejects %s", (_caseName, overrides) => {
    const toolInput = {
      projectId: PROJECT_ID,
      baseProjectResourcesId: PROJECT_RESOURCES_ID,
      fieldName: ManagedProfileFieldEnum.Phone,
      secretId: SECRET_ID,
      ...overrides,
    };

    expect(ManagedProfileFieldSetInputSchema.safeParse(toolInput).success).toBe(false);
  });
});
