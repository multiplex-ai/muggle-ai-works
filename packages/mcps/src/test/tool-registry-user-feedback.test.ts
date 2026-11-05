/**
 * Tests for the user feedback create tool on the cloud E2E registry.
 *
 * Covers:
 *   - the create tool declares that this client regenerates on the user's machine, which is what
 *     keeps the backend from answering it with an error for a locally generated target
 *   - the tool's own input fields reach the request unchanged
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

describe("muggle-remote-user-feedback-create", () => {
  const toolInput = {
    projectId: VALID_UUID,
    target: { targetType: "actionScript", targetId: VALID_UUID },
    feedbackText: "It clicked the wrong button",
  };

  it("declares that this client regenerates locally", () => {
    const upstreamRequest = getQaToolByName("muggle-remote-user-feedback-create")!.mapToUpstream!(toolInput);

    expect(upstreamRequest.body).toEqual(expect.objectContaining({ canRegenerateLocally: true }));
  });

  it("posts the input fields unchanged", () => {
    const upstreamRequest = getQaToolByName("muggle-remote-user-feedback-create")!.mapToUpstream!(toolInput);

    expect(upstreamRequest.method).toBe("POST");
    expect(upstreamRequest.path).toBe("/v1/protected/muggle-test/user-feedback");
    expect(upstreamRequest.body).toEqual(expect.objectContaining(toolInput));
  });
});
