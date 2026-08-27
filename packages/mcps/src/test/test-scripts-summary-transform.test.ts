import { describe, expect, it } from "vitest";

import type { IUpstreamResponse } from "../mcp/e2e/types.js";
import {
  mapTestScriptsSummary,
  type ITestScriptsSummaryOutput,
} from "../mcp/tools/e2e/test-scripts-summary-transform.js";

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    useCase: { id: "uc-1", title: "Use case 1" },
    testCase: { id: "tc-1", title: "Test case 1" },
    testScript: { id: "ts-1" },
    status: "TEST_SCRIPT_ACTIVE",
    lastRunAt: 1000,
    ...overrides,
  };
}

function makeEnvelopeResponse(envelope: Record<string, unknown>): IUpstreamResponse {
  return { statusCode: 200, data: envelope, headers: {} };
}

describe("mapTestScriptsSummary", () => {
  it("slims each row to the fields an agent reasons about", () => {
    const out = mapTestScriptsSummary(
      makeEnvelopeResponse({ data: [makeEntry()], page: 1, pageSize: 20, totalCount: 1 })
    );

    expect(out.scripts).toEqual([
      {
        status: "TEST_SCRIPT_ACTIVE",
        testCaseId: "tc-1",
        testCaseTitle: "Test case 1",
        useCaseId: "uc-1",
        useCaseTitle: "Use case 1",
        testScriptId: "ts-1",
        lastRunAt: 1000,
      },
    ]);
  });

  it("keeps a row that has no script, omitting testScriptId rather than dropping it", () => {
    const out = mapTestScriptsSummary(
      makeEnvelopeResponse({
        data: [makeEntry({ testScript: undefined, status: "TEST_CASE_DRAFTED", lastRunAt: undefined })],
        totalCount: 1,
      })
    );

    // A hand-written case with no script is exactly what this endpoint exists to surface.
    expect(out.scripts).toHaveLength(1);
    expect(out.scripts[0].status).toBe("TEST_CASE_DRAFTED");
    expect(out.scripts[0].testCaseId).toBe("tc-1");
    expect(out.scripts[0]).not.toHaveProperty("testScriptId");
  });

  it("omits absent optional fields rather than nulling them", () => {
    const out = mapTestScriptsSummary(
      makeEnvelopeResponse({ data: [{ status: "TEST_SCRIPT_ACTIVE" }], totalCount: 1 })
    );

    expect(out.scripts[0]).toEqual({ status: "TEST_SCRIPT_ACTIVE" });
  });

  it("buckets a missing status as UNKNOWN", () => {
    const out = mapTestScriptsSummary(makeEnvelopeResponse({ data: [makeEntry({ status: undefined })] }));

    expect(out.scripts[0].status).toBe("UNKNOWN");
  });

  it("passes the envelope's pagination through untouched", () => {
    const out = mapTestScriptsSummary(
      makeEnvelopeResponse({
        data: [makeEntry()],
        page: 3,
        pageSize: 20,
        totalCount: 116,
        totalPages: 6,
        hasMore: true,
      })
    );

    expect(out.page).toBe(3);
    expect(out.pageSize).toBe(20);
    expect(out.totalCount).toBe(116);
    expect(out.totalPages).toBe(6);
    expect(out.hasMore).toBe(true);
  });

  it("returns an empty page rather than throwing when the envelope carries no rows", () => {
    const out = mapTestScriptsSummary(makeEnvelopeResponse({ data: [], page: 1, pageSize: 20, totalCount: 0 }));

    expect(out.scripts).toEqual([]);
    expect(out.totalPages).toBe(0);
  });

  it("falls back sensibly when envelope fields are missing", () => {
    const out = mapTestScriptsSummary(makeEnvelopeResponse({ data: [makeEntry()] }));

    expect(out.page).toBe(1);
    expect(out.pageSize).toBe(1);
    expect(out.totalCount).toBe(1);
    expect(out.totalPages).toBe(1);
    expect(out.hasMore).toBe(false);
  });

  it("handles a heavy page payload from upstream — backend slices, MCP slims", () => {
    const heavyUseCase = {
      id: "uc-heavy",
      title: "Heavy use case",
      description: "x".repeat(800),
      useCaseBreakdown: Array.from({ length: 6 }, () => ({
        requirement: "x".repeat(200),
        acceptanceCriteria: "x".repeat(400),
      })),
    };
    const heavyEntries = Array.from({ length: 20 }, () =>
      makeEntry({
        useCase: heavyUseCase,
        testScript: { id: "ts-1", actionScriptId: "as-1", steps: Array.from({ length: 30 }, () => ({ instruction: "x".repeat(120) })) },
        latestWorkflowRun: { id: "wf-1", studioReturnedResult: { structuredSummary: { detail: "x".repeat(600) } } },
      })
    );

    const rawSize = JSON.stringify(heavyEntries).length;
    const out = mapTestScriptsSummary(
      makeEnvelopeResponse({
        data: heavyEntries,
        page: 1,
        pageSize: 20,
        totalCount: 116,
        totalPages: 6,
        hasMore: true,
      })
    ) as ITestScriptsSummaryOutput;
    const slimSize = JSON.stringify(out).length;

    expect(slimSize).toBeLessThan(rawSize * 0.1);
    expect(out.scripts).toHaveLength(20);
    expect(out.totalCount).toBe(116);
  });
});
