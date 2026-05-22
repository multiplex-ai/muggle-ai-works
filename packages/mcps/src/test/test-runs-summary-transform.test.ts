import { describe, expect, it } from "vitest";

import {
  mapTestRunsSummary,
  type ITestRunsSummaryInput,
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

function makeResponse(entries: unknown[]): IUpstreamResponse {
  return { statusCode: 200, data: entries, headers: {} };
}

const DEFAULTS: ITestRunsSummaryInput = {
  page: 1,
  pageSize: 20,
  sortBy: "lastRunAt",
  sortOrder: "desc",
};

describe("mapTestRunsSummary", () => {
  it("slims each entry down to the LLM-relevant fields", () => {
    const out = mapTestRunsSummary(
      makeResponse([
        makeEntry({
          error: "boom",
          status: "TEST_REPLAY_FAILED",
        }),
      ]),
      DEFAULTS,
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

  it("aggregates status counts over the full upstream list, not just the page", () => {
    const entries = [
      ...Array.from({ length: 30 }, () => makeEntry({ status: "TEST_REPLAY_FAILED" })),
      ...Array.from({ length: 10 }, () => makeEntry({ status: "TEST_REPLAY_SUCCESS" })),
    ];

    const out = mapTestRunsSummary(makeResponse(entries), {
      ...DEFAULTS,
      pageSize: 5,
    }) as ITestRunsSummaryOutput;

    expect(out.totals).toEqual({
      total: 40,
      byStatus: { TEST_REPLAY_FAILED: 30, TEST_REPLAY_SUCCESS: 10 },
    });
    expect(out.runs).toHaveLength(5);
  });

  it("omits missing optional fields rather than emitting null", () => {
    const out = mapTestRunsSummary(
      makeResponse([
        {
          status: "GENERATION_PENDING",
          testCase: { id: "tc-X" },
        },
      ]),
      DEFAULTS,
    ) as ITestRunsSummaryOutput;

    expect(out.runs[0]).toEqual({
      status: "GENERATION_PENDING",
      testCaseId: "tc-X",
    });
  });

  it("buckets entries with no status under UNKNOWN", () => {
    const out = mapTestRunsSummary(
      makeResponse([{ testCase: { id: "tc-1" } }]),
      DEFAULTS,
    ) as ITestRunsSummaryOutput;

    expect(out.totals.byStatus).toEqual({ UNKNOWN: 1 });
    expect(out.runs[0].status).toBe("UNKNOWN");
  });

  it("sorts by lastRunAt desc by default and sinks missing values to the end", () => {
    const out = mapTestRunsSummary(
      makeResponse([
        makeEntry({ testCase: { id: "old" }, lastRunAt: 100 }),
        makeEntry({ testCase: { id: "missing" }, lastRunAt: undefined }),
        makeEntry({ testCase: { id: "new" }, lastRunAt: 500 }),
      ]),
      DEFAULTS,
    ) as ITestRunsSummaryOutput;

    expect(out.runs.map((r) => r.testCaseId)).toEqual(["new", "old", "missing"]);
  });

  it("paginates the slimmed slice and reports hasMore correctly", () => {
    const entries = Array.from({ length: 25 }, (_, i) =>
      makeEntry({ testCase: { id: `tc-${i}`, title: `T${i}` }, lastRunAt: i }),
    );

    const page1 = mapTestRunsSummary(makeResponse(entries), {
      ...DEFAULTS,
      pageSize: 10,
      page: 1,
    }) as ITestRunsSummaryOutput;
    const page3 = mapTestRunsSummary(makeResponse(entries), {
      ...DEFAULTS,
      pageSize: 10,
      page: 3,
    }) as ITestRunsSummaryOutput;

    expect(page1).toMatchObject({ page: 1, totalPages: 3, hasMore: true });
    expect(page1.runs).toHaveLength(10);
    expect(page3).toMatchObject({ page: 3, totalPages: 3, hasMore: false });
    expect(page3.runs).toHaveLength(5);
  });

  it("returns an empty page with totalPages=1 when upstream returns no entries", () => {
    const out = mapTestRunsSummary(makeResponse([]), DEFAULTS) as ITestRunsSummaryOutput;
    expect(out).toEqual({
      totals: { total: 0, byStatus: {} },
      page: 1,
      pageSize: 20,
      totalPages: 1,
      hasMore: false,
      runs: [],
    });
  });

  it("dramatically shrinks a realistic 116-entry upstream payload", () => {
    const heavyUseCase = {
      id: "uc-heavy",
      title: "Heavy use case",
      description: "x".repeat(800),
      useCaseBreakdown: Array.from({ length: 6 }, () => ({
        requirement: "x".repeat(200),
        acceptanceCriteria: "x".repeat(400),
      })),
      userTestPrompt: { instruction: "x".repeat(900) },
    };
    const heavyTestCase = {
      id: "tc-heavy",
      title: "Heavy",
      description: "x".repeat(500),
      tags: ["a", "b", "c"],
    };
    const heavyEntries = Array.from({ length: 116 }, () => ({
      projectId: "p",
      useCase: heavyUseCase,
      testCase: heavyTestCase,
      latestWorkflowRun: {
        id: "wf",
        taskDef: { studioAuthInfo: { accessToken: "x".repeat(200) } },
      },
      testScript: { id: "ts", displayParams: {} },
      status: "TEST_REPLAY_FAILED",
      lastRunAt: 1000,
      error: "boom",
    }));

    const rawSize = JSON.stringify(heavyEntries).length;
    const out = mapTestRunsSummary(makeResponse(heavyEntries), DEFAULTS) as ITestRunsSummaryOutput;
    const slimSize = JSON.stringify(out).length;

    expect(slimSize).toBeLessThan(rawSize * 0.1);
    expect(out.totals.total).toBe(116);
  });
});
