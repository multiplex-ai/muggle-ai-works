import { WATCHER_LIVENESS_STALE_AFTER_MS } from "./constants.js";

/**
 * A watcher is live when either beacon is fresh: the watch loop's heartbeat
 * (touched every iteration, so a quiet monitor still reads as alive) or the
 * newest followup.log tick line (a 1m recovery cron logs a tick every fire).
 * Non-tick lines are not beacons — arming announcements, cycle notes, and
 * errors record activity by a session that may already be gone; logging is
 * not polling.
 */
export function isWatcherLive(args: {
  heartbeatMtimeMs: number | null;
  newestTickLineTimestampMs: number | null;
  nowMs: number;
  staleAfterMs?: number;
}): boolean {
  const staleAfterMs = args.staleAfterMs ?? WATCHER_LIVENESS_STALE_AFTER_MS;
  const newestBeaconMs = Math.max(
    args.heartbeatMtimeMs ?? Number.NEGATIVE_INFINITY,
    args.newestTickLineTimestampMs ?? Number.NEGATIVE_INFINITY,
  );
  return args.nowMs - newestBeaconMs < staleAfterMs;
}
