/**
 * Tests that every secret tool hands the agent the secret's metadata and never a value, whatever
 * the upstream body carries.
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
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

vi.mock("../mcp/e2e/upstream-client.js", () => ({ getPromptServiceClient: () => ({ execute: vi.fn() }) }));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { GatewayError, McpErrorCode } from "../mcp/e2e/types.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "9a7b2c4d-0000-4000-8000-000000000001";
const SECRET_ID = "5e1c3a2b-0000-4000-8000-000000000002";
const FAKE_SECRET_VALUE = "fake-secret-value-for-tests";

const secretListTool = () => {
  const tool = getQaToolByName("muggle-remote-secret-list");
  expect(tool).toBeDefined();
  expect(tool!.mapFromUpstream).toBeDefined();
  return tool!;
};

describe("muggle-remote-secret-list", () => {
  it("returns each secret's metadata without its value, even when upstream sends one", () => {
    const output = secretListTool().mapFromUpstream!({
      statusCode: 200,
      headers: {},
      data: [
        {
          id: SECRET_ID,
          projectId: PROJECT_ID,
          secretName: "login_password",
          value: FAKE_SECRET_VALUE,
          description: "Admin login",
          source: "user",
          createdAt: 1_700_000_000_000,
          lastModifiedAt: 1_700_000_000_001,
          isDeleted: false,
          ttl: 1_800_000_000_000,
        },
      ],
    });

    expect(output).toEqual([
      {
        id: SECRET_ID,
        projectId: PROJECT_ID,
        secretName: "login_password",
        description: "Admin login",
        source: "user",
        createdAt: 1_700_000_000_000,
        lastModifiedAt: 1_700_000_000_001,
      },
    ]);
    expect(JSON.stringify(output)).not.toContain(FAKE_SECRET_VALUE);
    expect(JSON.stringify(output)).not.toContain('"value"');
  });

  it("returns an empty list for a project without secrets", () => {
    const output = secretListTool().mapFromUpstream!({ statusCode: 200, headers: {}, data: [] });
    expect(output).toEqual([]);
  });

  it("fails as an upstream error when the body is not a list", () => {
    let thrownError: unknown;
    try {
      secretListTool().mapFromUpstream!({ statusCode: 200, headers: {}, data: { error: "unexpected" } });
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(GatewayError);
    expect((thrownError as GatewayError).code).toBe(McpErrorCode.UPSTREAM_ERROR);
  });

  it("tells the agent that values are never returned", () => {
    expect(secretListTool().description).toMatch(/values are never returned/i);
  });
});

describe.each(["muggle-remote-secret-get", "muggle-remote-secret-create", "muggle-remote-secret-update", "muggle-remote-secret-delete"])(
  "%s",
  (toolName) => {
    const singleSecretTool = () => {
      const tool = getQaToolByName(toolName);
      expect(tool).toBeDefined();
      expect(tool!.mapFromUpstream).toBeDefined();
      return tool!;
    };

    it("returns the secret's metadata without its value, even when upstream sends one", () => {
      const output = singleSecretTool().mapFromUpstream!({
        statusCode: 200,
        headers: {},
        data: {
          id: SECRET_ID,
          projectId: PROJECT_ID,
          secretName: "login_password",
          value: FAKE_SECRET_VALUE,
          description: "Admin login",
          source: "user",
          createdAt: 1_700_000_000_000,
          isDeleted: false,
        },
      });

      expect(output).toEqual({
        id: SECRET_ID,
        projectId: PROJECT_ID,
        secretName: "login_password",
        description: "Admin login",
        source: "user",
        createdAt: 1_700_000_000_000,
      });
      expect(JSON.stringify(output)).not.toContain(FAKE_SECRET_VALUE);
      expect(JSON.stringify(output)).not.toContain('"value"');
    });

    it("fails as an upstream error when the body is not a single secret", () => {
      let thrownError: unknown;
      try {
        singleSecretTool().mapFromUpstream!({ statusCode: 200, headers: {}, data: [] });
      } catch (error) {
        thrownError = error;
      }

      expect(thrownError).toBeInstanceOf(GatewayError);
      expect((thrownError as GatewayError).code).toBe(McpErrorCode.UPSTREAM_ERROR);
    });

    it("tells the agent the value is never returned", () => {
      expect(singleSecretTool().description).toMatch(/value is never (returned|echoed back)/i);
    });
  },
);
