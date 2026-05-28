/**
 * Tests for the muggle-remote-test-case-ancestors-get tool, which proxies the
 * test-plan-graph ancestor endpoint so callers can resolve a test case's
 * prerequisite chain before generating or replaying its script.
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

import { TestCaseAncestorsGetInputSchema } from "../mcp/e2e/contracts/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const TEST_CASE_ID = "33333333-3333-4333-8333-333333333333";

describe("muggle-remote-test-case-ancestors-get", () => {
  it("is registered and requires auth by default", () => {
    const tool = getQaToolByName("muggle-remote-test-case-ancestors-get");
    expect(tool).toBeDefined();
    expect(tool!.requiresAuth).not.toBe(false);
  });

  it("maps to the test-plan-graph ancestors GET endpoint", () => {
    const tool = getQaToolByName("muggle-remote-test-case-ancestors-get")!;
    const call = tool.mapToUpstream({ testCaseId: TEST_CASE_ID });
    expect(call.method).toBe("GET");
    expect(call.path).toBe(
      `/v1/protected/muggle-test/test-plan-graph/test-cases/${TEST_CASE_ID}/ancestors`,
    );
  });

  it("rejects a non-UUID testCaseId", () => {
    expect(() => TestCaseAncestorsGetInputSchema.parse({ testCaseId: "not-a-uuid" })).toThrow();
  });
});
