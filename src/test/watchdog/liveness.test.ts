import { describe, it, expect } from "vitest";
import { isWatcherLive } from "../../watchdog/liveness.js";

const NOW_MS = Date.parse("2026-07-23T12:00:00Z");
const MINUTE_MS = 60 * 1000;

describe("isWatcherLive", () => {
  it("fresh heartbeat alone is live — a quiet monitor logs nothing", () => {
    expect(
      isWatcherLive({
        heartbeatMtimeMs: NOW_MS - 2 * MINUTE_MS,
        newestFollowupLogTimestampMs: NOW_MS - 60 * MINUTE_MS,
        nowMs: NOW_MS,
      }),
    ).toBe(true);
  });

  it("fresh log line alone is live — a recovery cron has no heartbeat file", () => {
    expect(
      isWatcherLive({
        heartbeatMtimeMs: null,
        newestFollowupLogTimestampMs: NOW_MS - 1 * MINUTE_MS,
        nowMs: NOW_MS,
      }),
    ).toBe(true);
  });

  it("both beacons stale is dead", () => {
    expect(
      isWatcherLive({
        heartbeatMtimeMs: NOW_MS - 20 * MINUTE_MS,
        newestFollowupLogTimestampMs: NOW_MS - 16 * MINUTE_MS,
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });

  it("no beacon at all is dead", () => {
    expect(
      isWatcherLive({ heartbeatMtimeMs: null, newestFollowupLogTimestampMs: null, nowMs: NOW_MS }),
    ).toBe(false);
  });

  it("honors a custom staleness window", () => {
    expect(
      isWatcherLive({
        heartbeatMtimeMs: NOW_MS - 4 * MINUTE_MS,
        newestFollowupLogTimestampMs: null,
        nowMs: NOW_MS,
        staleAfterMs: 3 * MINUTE_MS,
      }),
    ).toBe(false);
  });
});
