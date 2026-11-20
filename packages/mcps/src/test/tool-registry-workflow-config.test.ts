/**
 * Tests for the project workflow config tools on the cloud E2E registry.
 *
 * Covers:
 *   - get, update and delete mapping to the project's workflow-config route
 *   - update sending only the settings groups the input touches, with a null tier clearing it
 *   - schema rejection of an empty update and of out-of-range max runtimes
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

import { ProjectWorkflowConfigUpdateInputSchema } from "../mcp/e2e/contracts/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKFLOW_CONFIG_PATH = `/v1/protected/muggle-test/workflow-config/project/${PROJECT_ID}`;

function mapToolInput(toolName: string, toolInput: Record<string, unknown>) {
  const tool = getQaToolByName(toolName)!;
  return tool.mapToUpstream(tool.inputSchema.parse(toolInput));
}

describe("muggle-remote-project-workflow-config-get", () => {
  it("reads the project's workflow config", () => {
    const upstreamCall = mapToolInput("muggle-remote-project-workflow-config-get", { projectId: PROJECT_ID });

    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe(WORKFLOW_CONFIG_PATH);
    expect(upstreamCall.body).toBeUndefined();
  });
});

describe("muggle-remote-project-workflow-config-update", () => {
  it("sends only the touched groups", () => {
    const upstreamCall = mapToolInput("muggle-remote-project-workflow-config-update", {
      projectId: PROJECT_ID,
      modelTier: "light",
      enableEverMemOS: false,
    });

    expect(upstreamCall.method).toBe("PUT");
    expect(upstreamCall.path).toBe(WORKFLOW_CONFIG_PATH);
    expect(upstreamCall.body).toEqual({ workflowParams: { llm: { tier: "light" }, memory: { enableEverMemOS: false } } });
  });

  it("clears the tier with an empty llm group when modelTier is null", () => {
    const upstreamCall = mapToolInput("muggle-remote-project-workflow-config-update", {
      projectId: PROJECT_ID,
      modelTier: null,
    });

    expect(upstreamCall.body).toEqual({ workflowParams: { llm: {} } });
  });

  it("sends both memory switches and the max runtimes together", () => {
    const upstreamCall = mapToolInput("muggle-remote-project-workflow-config-update", {
      projectId: PROJECT_ID,
      enableSharedTestMemory: true,
      enableEverMemOS: true,
      maxRunTimeMs: { testScriptReplay: 600000 },
    });

    expect(upstreamCall.body).toEqual({
      workflowParams: {
        memory: { enableSharedTestMemory: true, enableEverMemOS: true },
        maxRunTimeMs: { testScriptReplay: 600000 },
      },
    });
  });

  it.each([
    ["no setting", { projectId: PROJECT_ID }],
    ["a max runtime below one minute", { projectId: PROJECT_ID, maxRunTimeMs: { websiteScan: 59999 } }],
    ["a max runtime above one hour", { projectId: PROJECT_ID, maxRunTimeMs: { websiteScan: 3600001 } }],
    ["an unknown workflow kind", { projectId: PROJECT_ID, maxRunTimeMs: { custom: 600000 } }],
    ["an unknown model tier", { projectId: PROJECT_ID, modelTier: "premium" }],
    ["a projectId that is not a UUID", { projectId: "PRJ-1", modelTier: "light" }],
  ])("rejects %s", (_caseName, toolInput) => {
    expect(ProjectWorkflowConfigUpdateInputSchema.safeParse(toolInput).success).toBe(false);
  });
});

describe("muggle-remote-project-workflow-config-delete", () => {
  it("deletes the project's workflow config and reports it deleted", () => {
    const tool = getQaToolByName("muggle-remote-project-workflow-config-delete")!;
    const toolInput = tool.inputSchema.parse({ projectId: PROJECT_ID });
    const upstreamCall = tool.mapToUpstream(toolInput);

    expect(upstreamCall.method).toBe("DELETE");
    expect(upstreamCall.path).toBe(WORKFLOW_CONFIG_PATH);
    expect(tool.mapFromUpstream!({ statusCode: 204, data: "", headers: {} }, toolInput)).toEqual({
      projectId: PROJECT_ID,
      isDeleted: true,
    });
  });

  it("tells the caller to confirm first", () => {
    expect(getQaToolByName("muggle-remote-project-workflow-config-delete")!.description).toContain("Confirm with the user first");
  });
});
