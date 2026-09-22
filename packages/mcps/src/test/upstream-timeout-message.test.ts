/**
 * Tests for how an upstream timeout is reported.
 *
 * A timeout means the reply never arrived, not that the work did not happen. Seen live: a
 * test-case update timed out three times, each attempt landing upstream, while every reply
 * said the edit had failed — so the caller retried a write that had already applied.
 */

import { AxiosError } from "axios";
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

const timeoutError = () =>
  Object.assign(new AxiosError("timeout of 1000ms exceeded"), { code: "ECONNABORTED" });

const runWithTimeout = async (method: string) => {
  const { PromptServiceClient } = await import("../mcp/e2e/upstream-client.js");
  const client = new PromptServiceClient();
  // The instance builds its own axios client; fail its request with a timeout.
  (client as unknown as { httpClient: { request: () => Promise<never> } }).httpClient = {
    request: () => Promise.reject(timeoutError()),
  };

  try {
    await client.execute(
      { method: method, path: "/v1/protected/muggle-test/test-cases/tc-1", body: { id: "tc-1" } } as never,
      { bearerToken: "token" } as never,
      "correlation-1",
    );
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the call to reject");
};

describe("upstream timeout reporting", () => {
  it("warns that a timed-out write may already have been applied", async () => {
    const message = await runWithTimeout("PUT");
    expect(message).toContain("Request timeout");
    expect(message).toContain("may still have been applied upstream");
    expect(message).toContain("re-read the resource before retrying");
  });

  it("says the same for every other mutating method", async () => {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      expect(await runWithTimeout(method)).toContain("may still have been applied upstream");
    }
  });

  it("leaves a read's timeout message alone — a GET changes nothing", async () => {
    const message = await runWithTimeout("GET");
    expect(message).toContain("Request timeout");
    expect(message).not.toContain("may still have been applied");
  });
});
