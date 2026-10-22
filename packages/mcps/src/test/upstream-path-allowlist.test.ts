/**
 * Tests for the upstream path allowlist: the organization membership read is
 * reachable, while the rest of the organization routes stay closed to agents.
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

const executeGetAsync = async (path: string) => {
  const { PromptServiceClient } = await import("../mcp/e2e/upstream-client.js");
  const client = new PromptServiceClient();
  // The instance builds its own axios client; answer every request it lets through.
  (client as unknown as { httpClient: { request: () => Promise<unknown> } }).httpClient = {
    request: () => Promise.resolve({ status: 200, data: { organizations: [] }, headers: {} }),
  };
  return client.execute({ method: "GET", path: path } as never, { bearerToken: "token" } as never, "correlation-1");
};

describe("upstream path allowlist", () => {
  it("lets the caller's organization memberships through", async () => {
    const upstreamResponse = await executeGetAsync("/v1/protected/organizations/my-organizations");
    expect(upstreamResponse.data).toEqual({ organizations: [] });
  });

  it("keeps the other organization routes closed", async () => {
    await expect(executeGetAsync("/v1/protected/organizations/org-1/members")).rejects.toThrow("is not allowed");
    await expect(executeGetAsync("/v1/protected/organizations/org-1")).rejects.toThrow("is not allowed");
  });
});
