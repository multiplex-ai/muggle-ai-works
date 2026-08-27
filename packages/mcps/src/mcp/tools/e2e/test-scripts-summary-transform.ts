/**
 * Slim the per-row payload returned by the test-scripts/summary endpoint.
 *
 * The rows are one per TEST CASE, not one per script: a case that has never
 * produced a script still gets a row, carrying its lifecycle status and no
 * script id. Surfacing those is the point of the endpoint, so the transform
 * keeps them and simply omits `testScriptId` — it must never drop such a row
 * or invent an id, either of which would hide a case that needs generating.
 *
 * Each raw row carries the full use case, the test case state view, the script
 * definition, the latest workflow run and its studio result; an agent reasons
 * over almost none of that, so the wire payload is cut to the identifying and
 * status fields.
 *
 * No input type lives here: the request shape is owned and validated by
 * `ProjectTestScriptsSummaryInputSchema` in `mcp/e2e/contracts`, and the tool
 * handler derives its parameter type from that schema via `z.infer`.
 *
 * No per-page aggregate is emitted, for the same reason the runs transform
 * omits one: a histogram over a single page describes only that page and
 * misleads about project-wide health.
 */

import type { IUpstreamResponse } from "../../e2e/types.js";

interface IRawScriptsSummaryEntry {
    useCase?: { id?: string; title?: string };
    testCase?: { id?: string; title?: string };
    testScript?: { id?: string };
    status?: string;
    lastRunAt?: number;
    error?: string;
}

interface IRawScriptsEnvelope {
    data?: IRawScriptsSummaryEntry[];
    page?: number;
    pageSize?: number;
    totalCount?: number;
    totalPages?: number;
    hasMore?: boolean;
}

interface ISlimScriptsSummaryEntry {
    status: string;
    testCaseId?: string;
    testCaseTitle?: string;
    useCaseId?: string;
    useCaseTitle?: string;
    testScriptId?: string;
    lastRunAt?: number;
    error?: string;
}

export interface ITestScriptsSummaryOutput {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
    scripts: ISlimScriptsSummaryEntry[];
}

const UNKNOWN_STATUS = "UNKNOWN";

/** Keeps only the fields an agent reasons about, omitting absent ones rather than nulling them. */
function slimScriptsEntry(raw: IRawScriptsSummaryEntry): ISlimScriptsSummaryEntry {
    return {
        status: raw.status || UNKNOWN_STATUS,
        ...(raw.testCase?.id && { testCaseId: raw.testCase.id }),
        ...(raw.testCase?.title && { testCaseTitle: raw.testCase.title }),
        ...(raw.useCase?.id && { useCaseId: raw.useCase.id }),
        ...(raw.useCase?.title && { useCaseTitle: raw.useCase.title }),
        ...(raw.testScript?.id && { testScriptId: raw.testScript.id }),
        ...(raw.lastRunAt && { lastRunAt: raw.lastRunAt }),
        ...(raw.error && { error: raw.error }),
    };
}

/**
 * Maps the upstream scripts-summary envelope to the slimmed tool response.
 *
 * Output shape: `{ page, pageSize, totalCount, totalPages, hasMore, scripts: [...] }`
 */
export function mapTestScriptsSummary(response: IUpstreamResponse): ITestScriptsSummaryOutput {
    const envelope = (response.data ?? {}) as IRawScriptsEnvelope;
    const scripts = Array.isArray(envelope.data) ? envelope.data.map(slimScriptsEntry) : [];
    return {
        page: envelope.page ?? 1,
        pageSize: envelope.pageSize ?? scripts.length,
        totalCount: envelope.totalCount ?? scripts.length,
        totalPages: envelope.totalPages ?? (scripts.length === 0 ? 0 : 1),
        hasMore: envelope.hasMore ?? false,
        scripts: scripts,
    };
}
