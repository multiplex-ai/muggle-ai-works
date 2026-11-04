/**
 * Tests for the report cost tools on the cloud E2E registry.
 *
 * Covers:
 *   - the cost-query schema matches the backend contract, so a schema-valid call is never a 400
 *   - the cost-query request body carries every field through
 *   - both report tools pass the API payload, cost breakdown included, through unchanged
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

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const COST_QUERY_TOOL_NAME = "muggle-remote-report-cost-query";
const STATS_SUMMARY_TOOL_NAME = "muggle-remote-report-stats-summary-get";

const getToolOrThrow = (name: string) => {
  const tool = getQaToolByName(name);
  if (!tool) throw new Error(`${name} is not registered`);
  return tool;
};

describe("muggle-remote-report-cost-query input schema", () => {
  const costQueryTool = getToolOrThrow(COST_QUERY_TOOL_NAME);

  it("accepts a project-wide query with a UTC date range", () => {
    const parsed = costQueryTool.inputSchema.safeParse({
      projectId: PROJECT_ID,
      filterType: "project",
      filterIds: [PROJECT_ID],
      startDateKey: "11-01-2026",
      endDateKey: "11-02-2026",
    });
    expect(parsed.success).toBe(true);
  });

  it("requires filterType and a non-empty filterIds, as the backend does", () => {
    expect(costQueryTool.inputSchema.safeParse({ projectId: PROJECT_ID }).success).toBe(false);
    expect(
      costQueryTool.inputSchema.safeParse({ projectId: PROJECT_ID, filterType: "project", filterIds: [] }).success,
    ).toBe(false);
  });

  it("rejects date keys that are not MM-DD-YYYY", () => {
    const parsed = costQueryTool.inputSchema.safeParse({
      projectId: PROJECT_ID,
      filterType: "project",
      filterIds: [PROJECT_ID],
      startDateKey: "20261101",
      endDateKey: "20261102",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("report cost tools upstream mapping", () => {
  it("posts every cost-query field to the cost query endpoint", () => {
    const costQueryTool = getToolOrThrow(COST_QUERY_TOOL_NAME);
    const toolInput = {
      projectId: PROJECT_ID,
      filterType: "testCase",
      filterIds: [PROJECT_ID],
      startDateKey: "11-01-2026",
      endDateKey: "11-02-2026",
    };

    expect(costQueryTool.mapToUpstream(toolInput)).toEqual({
      method: "POST",
      path: "/v1/protected/muggle-test/report/cost/query",
      body: toolInput,
    });
  });

  it.each([COST_QUERY_TOOL_NAME, STATS_SUMMARY_TOOL_NAME])(
    "%s passes the API payload through without reshaping it",
    (toolName) => {
      expect(getToolOrThrow(toolName).mapFromUpstream).toBeUndefined();
    },
  );
});
