/**
 * Tests for the local tool registry after the studio took over publishing.
 *
 * The studio publishes each run during execution and carries the cloud
 * identifiers back on the run result, so:
 *   - the `muggle-local-publish-test-script` tool no longer exists, and
 *   - `muggle-local-run-result-get` surfaces the studio's cloud refs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  return {
    getLogger: () => fakeLogger,
    createChildLogger: () => fakeLogger,
    resetLogger: noop,
  };
});

const mockGetRunResult = vi.fn();

vi.mock("../mcp/local/services/index.js", () => ({
  cancelExecution: vi.fn(),
  executeReplay: vi.fn(),
  executeTestGeneration: vi.fn(),
  getAuthService: () => ({ getAuthStatus: () => ({ authenticated: true }) }),
  getStorageService: () => ({
    getDataDir: () => "/tmp",
    getSessionsDir: () => "/tmp",
  }),
  getRunResultStorageService: () => ({
    getRunResult: mockGetRunResult,
    getTestScript: vi.fn(),
  }),
}));

import { getTool } from "../mcp/tools/local/tool-registry.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

describe("local tool registry — studio publishes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no longer exposes the publish tool", () => {
    expect(getTool("muggle-local-publish-test-script")).toBeUndefined();
  });

  it("surfaces the studio's cloud refs from muggle-local-run-result-get", async () => {
    mockGetRunResult.mockReturnValue({
      id: RUN_ID,
      runType: "generation",
      status: "passed",
      cloudTestCaseId: "tc-1",
      executionTimeMs: 1234,
      viewUrl: "https://www.muggle-ai.com/run/abc",
      cloudTestScriptId: "cloud-ts-1",
      cloudActionScriptId: "cloud-as-1",
    });

    const tool = getTool("muggle-local-run-result-get");
    expect(tool).toBeDefined();

    const result = await tool!.execute({
      input: { runId: RUN_ID },
      correlationId: "test-corr",
    } as never);

    expect(result.isError).toBe(false);
    expect(result.content).toContain("https://www.muggle-ai.com/run/abc");
    expect(result.content).toContain("cloud-ts-1");
    expect(result.content).toContain("cloud-as-1");
    expect(result.data).toMatchObject({
      viewUrl: "https://www.muggle-ai.com/run/abc",
      cloudTestScriptId: "cloud-ts-1",
      cloudActionScriptId: "cloud-as-1",
    });
  });
});
