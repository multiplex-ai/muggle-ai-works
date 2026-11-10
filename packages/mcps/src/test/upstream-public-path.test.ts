/**
 * Tests for the upstream client's public routes: the product catalog answers a signed-out caller,
 * while every other route still needs credentials and the rest of /v1/public stays closed.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: { promptServiceBaseUrl: "http://test.invalid", requestTimeoutMs: 1000, workflowTimeoutMs: 5000 },
  }),
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fakeLogger };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

const executeGetAsync = async (path: string, credentials: Record<string, string>) => {
  const { PromptServiceClient } = await import("../mcp/e2e/upstream-client.js");
  const client = new PromptServiceClient();
  // The instance builds its own axios client; answer every request it lets through.
  (client as unknown as { httpClient: { request: () => Promise<unknown> } }).httpClient = {
    request: () => Promise.resolve({ status: 200, data: { tiers: {} }, headers: {} }),
  };
  return client.execute({ method: "GET", path: path } as never, credentials as never, "correlation-1");
};

describe("upstream public routes", () => {
  it("reaches the product catalog without credentials", async () => {
    const upstreamResponse = await executeGetAsync("/v1/public/product-catalog", {});
    expect(upstreamResponse.data).toEqual({ tiers: {} });
  });

  it("still refuses a protected route without credentials", async () => {
    await expect(executeGetAsync("/v1/protected/wallet/packages", {})).rejects.toThrow("Missing authentication");
  });

  it("keeps other public routes closed", async () => {
    await expect(executeGetAsync("/v1/public/product-catalog-admin", { bearerToken: "token" })).rejects.toThrow("is not allowed");
    await expect(executeGetAsync("/v1/public/other", { bearerToken: "token" })).rejects.toThrow("is not allowed");
  });
});
