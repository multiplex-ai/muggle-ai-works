import { describe, expect, it } from "vitest";

import {
  mapTestRunsSummary,
  type ITestRunsSummaryOutput,
} from "../mcp/tools/e2e/test-runs-summary-transform.js";
import type { IUpstreamResponse } from "../mcp/e2e/types.js";

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    useCase: { id: "uc-1", title: "Use case 1" },
    testCase: { id: "tc-1", title: "Test case 1" },
    latestWorkflowRun: { id: "wf-1" },
    status: "TEST_REPLAY_SUCCESS",
    lastRunAt: 1000,
    ...overrides,
  };
}

function makeEnvelopeResponse(envelope: Record<string, unknown>): IUpstreamResponse {
  return { statusCode: 200, data: envelope, headers: {} };
}

describe("mapTestRunsSummary", () => {
  it("slims each entry inside the envelope down to LLM-relevant fields", () => {
    const out = mapTestRunsSummary(
      makeEnvelopeResponse({
        data: [makeEntry({ error: "boom", status: "TEST_REPLAY_FAILED" })],
        page: 1,
        pageSize: 20,
        totalCount: 1,
        totalPages: 1,
        hasMore: false,
      }),
    ) as ITestRunsSummaryOutput;

    expect(out.runs).toEqual([
      {
        status: "TEST_REPLAY_FAILED",
        testCaseId: "tc-1",
        testCaseTitle: "Test case 1",
        useCaseId: "uc-1",
        useCaseTitle: "Use case 1",
        lastRunAt: 1000,
        error: "boom",
        latestWorkflowRunId: "wf-1",
      },
    ]);
  });

  it("passes envelope pagination metadata through unchanged", () => {
    const out = mapTestRunsSummary(
      makeEnvelopeResponse({
        data: [makeEntry(), makeEntry()],
        page: 3,
        pageSize: 20,
        totalCount: 116,
        totalPages: 6,
        hasMore: true,
      }),
    ) as ITestRunsSummaryOutput;

    expect(out.page).toBe(3);
    expect(out.pageSize).toBe(20);
    expect(out.totalCount).toBe(116);
    expect(out.totalPages).toBe(6);
    expect(out.hasMore).toBe(true);
  });

  it("omits missing optional fields rather than emitting null", () => {
    const out = mapTestRunsSummary(
      makeEnvelopeResponse({
        data: [{ status: "GENERATION_PENDING", testCase: { id: "tc-X" } }],
        page: 1,
        pageSize: 20,
        totalCount: 1,
        totalPages: 1,
        hasMore: false,
      }),
    ) as ITestRunsSummaryOutput;

    expect(out.runs[0]).toEqual({
      status: "GENERATION_PENDING",
      testCaseId: "tc-X",
    });
  });

  it("buckets entries with no status under UNKNOWN", () => {
    const out = mapTestRunsSummary(
      makeEnvelopeResponse({
        data: [{ testCase: { id: "tc-1" } }],
        page: 1,
        pageSize: 20,
        totalCount: 1,
        totalPages: 1,
        hasMore: false,
      }),
    ) as ITestRunsSummaryOutput;

    expect(out.runs[0].status).toBe("UNKNOWN");
  });

  it("returns an empty envelope when the upstream page is empty", () => {
    const out = mapTestRunsSummary(
      makeEnvelopeResponse({
        data: [],
        page: 1,
        pageSize: 20,
        totalCount: 0,
        totalPages: 0,
        hasMore: false,
      }),
    ) as ITestRunsSummaryOutput;

    expect(out).toEqual({
      page: 1,
      pageSize: 20,
      totalCount: 0,
      totalPages: 0,
      hasMore: false,
      runs: [],
    });
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
    const heavyEntries = Array.from({ length: 20 }, () => ({
      projectId: "p",
      useCase: heavyUseCase,
      testCase: { id: "tc-heavy", title: "Heavy", description: "x".repeat(500) },
      latestWorkflowRun: { id: "wf", taskDef: { studioAuthInfo: { accessToken: "x".repeat(200) } } },
      testScript: { id: "ts", displayParams: {} },
      status: "TEST_REPLAY_FAILED",
      lastRunAt: 1000,
      error: "boom",
    }));

    const rawSize = JSON.stringify(heavyEntries).length;
    const out = mapTestRunsSummary(
      makeEnvelopeResponse({
        data: heavyEntries,
        page: 1,
        pageSize: 20,
        totalCount: 116,
        totalPages: 6,
        hasMore: true,
      }),
    ) as ITestRunsSummaryOutput;
    const slimSize = JSON.stringify(out).length;

    expect(slimSize).toBeLessThan(rawSize * 0.1);
    expect(out.runs).toHaveLength(20);
    expect(out.totalCount).toBe(116);
  });

  it("falls back gracefully when the envelope is missing fields", () => {
    const out = mapTestRunsSummary(
      makeEnvelopeResponse({ data: [makeEntry()] }),
    ) as ITestRunsSummaryOutput;

    expect(out.page).toBe(1);
    expect(out.pageSize).toBe(1);
    expect(out.totalCount).toBe(1);
    expect(out.hasMore).toBe(false);
    expect(out.runs).toHaveLength(1);
  });
});
