/**
 * Slim + aggregate + paginate the upstream test-runs/summary payload.
 *
 * Upstream returns the full object graph (use case, test case, workflow run,
 * test script) per test-case row — ~150 lines × N test cases, which blows
 * past LLM token budgets on any non-trivial project. This transform keeps
 * only the fields an LLM needs to reason about run state and paginates the
 * result MCP-side (upstream does not support page params on this endpoint).
 */

import type { IUpstreamResponse } from "../../e2e/types.js";

interface IRawSummaryEntry {
  useCase?: { id?: string; title?: string };
  testCase?: { id?: string; title?: string };
  latestWorkflowRun?: { id?: string };
  status?: string;
  lastRunAt?: number;
  error?: string;
}

interface ISlimSummaryEntry {
  status: string;
  testCaseId?: string;
  testCaseTitle?: string;
  useCaseId?: string;
  useCaseTitle?: string;
  lastRunAt?: number;
  error?: string;
  latestWorkflowRunId?: string;
}

export interface ITestRunsSummaryInput {
  page: number;
  pageSize: number;
  sortBy: "lastRunAt" | "status" | "testCaseTitle";
  sortOrder: "asc" | "desc";
}

export interface ITestRunsSummaryOutput {
  totals: {
    total: number;
    byStatus: Record<string, number>;
  };
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  runs: ISlimSummaryEntry[];
}

const UNKNOWN_STATUS = "UNKNOWN";

function slimEntry(raw: IRawSummaryEntry): ISlimSummaryEntry {
  const slim: ISlimSummaryEntry = { status: raw.status ?? UNKNOWN_STATUS };
  if (raw.testCase?.id) slim.testCaseId = raw.testCase.id;
  if (raw.testCase?.title) slim.testCaseTitle = raw.testCase.title;
  if (raw.useCase?.id) slim.useCaseId = raw.useCase.id;
  if (raw.useCase?.title) slim.useCaseTitle = raw.useCase.title;
  if (typeof raw.lastRunAt === "number") slim.lastRunAt = raw.lastRunAt;
  if (raw.error) slim.error = raw.error;
  if (raw.latestWorkflowRun?.id) slim.latestWorkflowRunId = raw.latestWorkflowRun.id;
  return slim;
}

function aggregateByStatus(entries: readonly IRawSummaryEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const status = entry.status ?? UNKNOWN_STATUS;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function sortRuns(
  runs: readonly ISlimSummaryEntry[],
  sortBy: ITestRunsSummaryInput["sortBy"],
  sortOrder: ITestRunsSummaryInput["sortOrder"],
): ISlimSummaryEntry[] {
  const sign = sortOrder === "asc" ? 1 : -1;
  return [...runs].sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    // Missing values sink to the end under both asc and desc — a page of
    // failures shouldn't get padded with rows that have no signal — so we
    // apply this rule before the sortOrder sign flips anything.
    if (av === undefined && bv === undefined) return 0;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    return 0;
  });
}

export function mapTestRunsSummary(
  response: IUpstreamResponse,
  input?: unknown,
): ITestRunsSummaryOutput {
  const params = input as ITestRunsSummaryInput;
  const raw = Array.isArray(response.data) ? (response.data as IRawSummaryEntry[]) : [];

  const byStatus = aggregateByStatus(raw);
  const sorted = sortRuns(raw.map(slimEntry), params.sortBy, params.sortOrder);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
  const start = (params.page - 1) * params.pageSize;
  const runs = sorted.slice(start, start + params.pageSize);

  return {
    totals: { total: total, byStatus: byStatus },
    page: params.page,
    pageSize: params.pageSize,
    totalPages: totalPages,
    hasMore: params.page < totalPages,
    runs: runs,
  };
}
