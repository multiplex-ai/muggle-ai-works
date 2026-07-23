import { WATCHER_LIVENESS_STALE_AFTER_MS } from "./constants.js";

/**
 * A watcher is live when either beacon is fresh: the watch loop's heartbeat
 * (touched every iteration, so a quiet monitor still reads as alive) or the
 * newest followup.log line (a 1m recovery cron logs every tick).
 */
export function isWatcherLive(args: {
  heartbeatMtimeMs: number | null;
  newestFollowupLogTimestampMs: number | null;
  nowMs: number;
  staleAfterMs?: number;
}): boolean {
  const staleAfterMs = args.staleAfterMs ?? WATCHER_LIVENESS_STALE_AFTER_MS;
  const newestBeaconMs = Math.max(
    args.heartbeatMtimeMs ?? Number.NEGATIVE_INFINITY,
    args.newestFollowupLogTimestampMs ?? Number.NEGATIVE_INFINITY,
  );
  return args.nowMs - newestBeaconMs < staleAfterMs;
}
