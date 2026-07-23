import { CYCLE_IN_PROGRESS_GRACE_MS } from "./constants.js";

const DISPATCH_LINE_PATTERN = /\bdispatch/i;
const CYCLE_OUTCOME_LINE_PATTERN = /\boutcome=/i;

function lineTimestampMs(line: string): number | null {
  const firstToken = line.trimStart().split(/\s+/, 1)[0] ?? "";
  const parsed = Date.parse(firstToken);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Newest ISO-8601 line timestamp in a followup.log body, or null when none parse. */
export function newestFollowupLogTimestampMs(logText: string): number | null {
  let newestMs: number | null = null;
  for (const line of logText.split("\n")) {
    const timestampMs = lineTimestampMs(line);
    if (timestampMs !== null && (newestMs === null || timestampMs > newestMs)) {
      newestMs = timestampMs;
    }
  }
  return newestMs;
}

/**
 * A dispatch line newer than the last cycle-outcome line means a /muggle-do
 * cycle owns the PR — the watcher was deliberately stopped, so recovery must
 * hold off. Past the grace window the cycle is presumed crashed and recovery
 * may proceed.
 */
export function isCycleInProgress(args: {
  logText: string;
  nowMs: number;
  graceMs?: number;
}): boolean {
  const graceMs = args.graceMs ?? CYCLE_IN_PROGRESS_GRACE_MS;
  let lastDispatchMs: number | null = null;
  let lastOutcomeMs: number | null = null;
  for (const line of args.logText.split("\n")) {
    const timestampMs = lineTimestampMs(line);
    if (timestampMs === null) continue;
    if (CYCLE_OUTCOME_LINE_PATTERN.test(line)) {
      if (lastOutcomeMs === null || timestampMs > lastOutcomeMs) lastOutcomeMs = timestampMs;
    } else if (DISPATCH_LINE_PATTERN.test(line)) {
      if (lastDispatchMs === null || timestampMs > lastDispatchMs) lastDispatchMs = timestampMs;
    }
  }
  if (lastDispatchMs === null) return false;
  if (lastOutcomeMs !== null && lastOutcomeMs >= lastDispatchMs) return false;
  return args.nowMs - lastDispatchMs < graceMs;
}
