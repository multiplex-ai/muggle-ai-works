import { ProviderPrState } from "../guardrails/types.js";
import { TERMINAL_PR_RECHECK_MS } from "./constants.js";
import type { PrLiveStatus, SlotPr, TerminalPrRecord } from "./types.js";

function isRecheckDue(record: TerminalPrRecord | undefined, nowMs: number): boolean {
  if (!record) return true;
  const checkedAtMs = Date.parse(record.checkedAt);
  return Number.isNaN(checkedAtMs) || nowMs - checkedAtMs >= TERMINAL_PR_RECHECK_MS;
}

/**
 * Split the slots' PRs into the ones to ask GitHub about and the live statuses
 * the cache already answers. A cached PR reads as its terminal state and nothing
 * else, which is all a terminal PR's findings need.
 */
export function partitionByTerminalCache(
  prs: SlotPr[],
  terminalPrsByUrl: Record<string, TerminalPrRecord>,
  nowMs: number,
): { prsToQuery: SlotPr[]; cachedStatuses: PrLiveStatus[] } {
  const prsToQuery: SlotPr[] = [];
  const cachedStatuses: PrLiveStatus[] = [];
  for (const pr of prs) {
    const record = terminalPrsByUrl[pr.url];
    if (record && !isRecheckDue(record, nowMs)) {
      cachedStatuses.push({ url: pr.url, state: record.state, unresolvedThreadCount: 0 });
    } else {
      prsToQuery.push(pr);
    }
  }
  return { prsToQuery: prsToQuery, cachedStatuses: cachedStatuses };
}

/**
 * The cache after this tick: PRs GitHub just reported terminal are added, PRs it
 * reported open are dropped, and entries for PRs no slot lists any more are pruned.
 */
export function updateTerminalCache(
  terminalPrsByUrl: Record<string, TerminalPrRecord>,
  fetchedStatuses: PrLiveStatus[],
  trackedUrls: Set<string>,
  nowIso: string,
): Record<string, TerminalPrRecord> {
  const nextCache: Record<string, TerminalPrRecord> = {};
  for (const [url, record] of Object.entries(terminalPrsByUrl)) {
    if (trackedUrls.has(url)) nextCache[url] = record;
  }
  for (const fetched of fetchedStatuses) {
    if (fetched.state === ProviderPrState.Merged || fetched.state === ProviderPrState.Closed) {
      nextCache[fetched.url] = { state: fetched.state, checkedAt: nowIso };
    } else {
      delete nextCache[fetched.url];
    }
  }
  return nextCache;
}
