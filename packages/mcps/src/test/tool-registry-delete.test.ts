/**
 * Tests for the delete-by-id tools on the cloud E2E registry.
 *
 * Covers:
 *   - every delete-by-id tool is advertised and maps to the right verb + path
 *   - each input schema requires exactly one well-formed UUID
 *   - the action-script tool keeps warning that its delete is permanent
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

vi.mock("../mcp/e2e/upstream-client.js", () => ({
  getPromptServiceClient: () => ({ execute: vi.fn() }),
}));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

/**
 * One row per delete-by-id tool: the id field its schema requires and the
 * upstream path that id must land in. Paths are asserted in full because a
 * wrong prefix still type-checks and would only surface as a 404 at runtime.
 */
const DELETE_TOOL_CONTRACTS = [
  {
    name: "muggle-remote-project-delete",
    idField: "projectId",
    expectedPath: `/v1/protected/muggle-test/projects/${VALID_UUID}`,
  },
  {
    name: "muggle-remote-use-case-delete",
    idField: "useCaseId",
    expectedPath: `/v1/protected/muggle-test/use-cases/${VALID_UUID}`,
  },
  {
    name: "muggle-remote-test-case-delete",
    idField: "testCaseId",
    expectedPath: `/v1/protected/muggle-test/test-cases/${VALID_UUID}`,
  },
  {
    name: "muggle-remote-test-script-delete",
    idField: "testScriptId",
    expectedPath: `/v1/protected/muggle-test/test-scripts/${VALID_UUID}`,
  },
  {
    name: "muggle-remote-action-script-delete",
    idField: "actionScriptId",
    expectedPath: `/v1/protected/actionScript/${VALID_UUID}`,
  },
  {
    name: "muggle-remote-secret-delete",
    idField: "secretId",
    expectedPath: `/v1/protected/muggle-test/secrets/${VALID_UUID}`,
  },
] as const;

describe("cloud E2E tool registry — delete by id", () => {
  it.each(DELETE_TOOL_CONTRACTS)(
    "$name issues DELETE to its entity path",
    ({ name, idField, expectedPath }) => {
      const tool = getQaToolByName(name);
      expect(tool, `${name} must be advertised`).toBeDefined();

      const upstream = tool!.mapToUpstream({ [idField]: VALID_UUID });
      expect(upstream.method).toBe("DELETE");
      expect(upstream.path).toBe(expectedPath);
    },
  );

  it.each(DELETE_TOOL_CONTRACTS)("$name requires a well-formed id", ({ name, idField }) => {
    const inputSchema = getQaToolByName(name)!.inputSchema;

    expect(inputSchema.safeParse({}).success, `${name} must reject a missing id`).toBe(false);
    expect(
      inputSchema.safeParse({ [idField]: "not-a-uuid" }).success,
      `${name} must reject a malformed id`,
    ).toBe(false);
    expect(inputSchema.safeParse({ [idField]: VALID_UUID }).success).toBe(true);
  });

  // The other delete routes soft-delete behind a ttl; this one calls ref.delete().
  // If the wording ever drifts back to "soft delete", callers lose their only
  // signal that the action script is unrecoverable.
  it("warns that action-script delete is permanent", () => {
    const description = getQaToolByName("muggle-remote-action-script-delete")!.description;

    expect(description).toContain("Permanently delete");
    expect(description).toContain("cannot be undone");
    expect(description).not.toContain("soft delete");
  });

  // Deleting a use case takes its test cases and their scripts with it, which is
  // the largest blast radius on the delete surface.
  it("advertises the use-case delete cascade", () => {
    const description = getQaToolByName("muggle-remote-use-case-delete")!.description;

    expect(description).toContain("cascades");
    expect(description).toContain("test scripts");
  });
});
