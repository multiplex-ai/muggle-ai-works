/**
 * Slim the per-row payload returned by the paginated test-runs/summary
 * endpoint. The backend now handles sort + slice + envelope; this transform
 * keeps each row down to the fields an LLM actually reasons about so the
 * page slice doesn't carry duplicated useCase blocks and empty
 * studioAuthInfo nested objects across the wire.
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

interface IRawEnvelope {
  data?: IRawSummaryEntry[];
  page?: number;
  pageSize?: number;
  totalCount?: number;
  totalPages?: number;
  hasMore?: boolean;
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

export interface ITestRunsSummaryOutput {
  page: number;
  pageSize: number;
  totalCount: number;
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

export function mapTestRunsSummary(response: IUpstreamResponse): ITestRunsSummaryOutput {
  const envelope = (response.data ?? {}) as IRawEnvelope;
  const rawRuns = Array.isArray(envelope.data) ? envelope.data : [];
  const runs = rawRuns.map(slimEntry);

  return {
    page: envelope.page ?? 1,
    pageSize: envelope.pageSize ?? runs.length,
    totalCount: envelope.totalCount ?? runs.length,
    totalPages: envelope.totalPages ?? (runs.length === 0 ? 0 : 1),
    hasMore: envelope.hasMore ?? false,
    runs: runs,
  };
}
