/**
 * Tests for the report generation workflow tools on the cloud E2E registry.
 *
 * Covers:
 *   - list, get and update mapping to their routes, list scoped to one project
 *   - update sending only the provided fields and never a projectId
 *   - schema rejection of unknown report types, a projectId and an empty update
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

import {
  ReportGenerationListInputSchema,
  ReportGenerationTypeEnum,
  ReportGenerationUpdateInputSchema,
} from "../mcp/e2e/contracts/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const REPORT_GENERATION_PATH = `/v1/protected/muggle-test/workflow/report-generation/${WORKFLOW_ID}`;

function mapToolInput(toolName: string, toolInput: Record<string, unknown>) {
  const tool = getQaToolByName(toolName)!;
  return tool.mapToUpstream(tool.inputSchema.parse(toolInput));
}

describe("muggle-remote-report-generation-list", () => {
  it("lists the project's workflows by query", () => {
    const upstreamCall = mapToolInput("muggle-remote-report-generation-list", {
      projectId: PROJECT_ID,
      reportType: ReportGenerationTypeEnum.Summary,
    });

    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe("/v1/protected/muggle-test/workflow/report-generation");
    expect(upstreamCall.queryParams).toEqual({ projectId: PROJECT_ID, reportType: "summary" });
  });

  it.each([
    ["no projectId", {}],
    ["a projectId that is not a UUID", { projectId: "PRJ-1" }],
    ["an unknown report type", { projectId: PROJECT_ID, reportType: "executive" }],
  ])("rejects %s", (_caseName, toolInput) => {
    expect(ReportGenerationListInputSchema.safeParse(toolInput).success).toBe(false);
  });
});

describe("muggle-remote-report-generation-get", () => {
  it("reads the workflow", () => {
    const upstreamCall = mapToolInput("muggle-remote-report-generation-get", { workflowId: WORKFLOW_ID });

    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe(REPORT_GENERATION_PATH);
  });
});

describe("muggle-remote-report-generation-update", () => {
  it("puts only the provided fields", () => {
    const upstreamCall = mapToolInput("muggle-remote-report-generation-update", {
      workflowId: WORKFLOW_ID,
      reportType: ReportGenerationTypeEnum.Comprehensive,
    });

    expect(upstreamCall.method).toBe("PUT");
    expect(upstreamCall.path).toBe(REPORT_GENERATION_PATH);
    expect(upstreamCall.body).toEqual({ reportType: "comprehensive" });
    expect(upstreamCall.body).not.toHaveProperty("projectId");
  });

  it.each([
    ["a projectId", { workflowId: WORKFLOW_ID, name: "Weekly", projectId: PROJECT_ID }],
    ["an unknown report type", { workflowId: WORKFLOW_ID, reportType: "executive" }],
    ["no field", { workflowId: WORKFLOW_ID }],
  ])("rejects %s", (_caseName, toolInput) => {
    expect(ReportGenerationUpdateInputSchema.safeParse(toolInput).success).toBe(false);
  });
});
