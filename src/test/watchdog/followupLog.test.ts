import { describe, it, expect } from "vitest";
import { isCycleInProgress, newestTickLineTimestampMs } from "../../watchdog/followupLog.js";
import { isWatcherLive } from "../../watchdog/liveness.js";

const NOW_MS = Date.parse("2026-07-23T12:00:00Z");
const MINUTE_MS = 60 * 1000;

function minutesAgoIso(minutes: number): string {
  return new Date(NOW_MS - minutes * MINUTE_MS).toISOString();
}

describe("newestTickLineTimestampMs", () => {
  it("returns the newest tick-line timestamp", () => {
    const logText = [
      `${minutesAgoIso(30)} tick pr=154 threads=0 idle`,
      `${minutesAgoIso(10)} tick pr=154 threads=0 idle`,
      `${minutesAgoIso(20)} tick pr=154 threads=0 idle`,
    ].join("\n");
    expect(newestTickLineTimestampMs(logText)).toBe(NOW_MS - 10 * MINUTE_MS);
  });

  it("counts stale-tick and blocked/terminal tick lines", () => {
    const logText = [
      `${minutesAgoIso(20)} stale-tick pr=154`,
      `${minutesAgoIso(30)} tick pr=154 blocked reason=ci_escalated`,
    ].join("\n");
    expect(newestTickLineTimestampMs(logText)).toBe(NOW_MS - 20 * MINUTE_MS);
  });

  it("ignores non-tick lines — logging is not polling", () => {
    // The incident shape: a slot whose only fresh lines are arming/cycle
    // announcements has no live poller, yet the old any-line beacon read it
    // as alive and reconcile skipped the re-arm.
    const logText = [
      `${minutesAgoIso(60)} tick pr=154 threads=0 idle`,
      `${minutesAgoIso(3)} armed monitor-based watch (drain clean: 0 reviews)`,
      `${minutesAgoIso(2)} re-armed monitor watch after session restart`,
      `${minutesAgoIso(2)} cycle rebase pr=154 pushed=abc1234 watcher=not-rearmed`,
      `${minutesAgoIso(1)} slot x: Error: gh api exited 1 (HTTP 504)`,
      `${minutesAgoIso(1)} watchdog spawned recovery tick pr=154 reason=confirmed-signal`,
    ].join("\n");
    expect(newestTickLineTimestampMs(logText)).toBe(NOW_MS - 60 * MINUTE_MS);
    expect(
      isWatcherLive({
        heartbeatMtimeMs: null,
        newestTickLineTimestampMs: newestTickLineTimestampMs(logText),
        nowMs: NOW_MS,
      }),
    ).toBe(false);
  });

  it("returns null for empty, unparseable, or tick-free content", () => {
    expect(newestTickLineTimestampMs("")).toBeNull();
    expect(newestTickLineTimestampMs("no timestamp here\nnor here")).toBeNull();
    expect(
      newestTickLineTimestampMs(`${minutesAgoIso(1)} re-armed (silent watcher)`),
    ).toBeNull();
  });
});

describe("isCycleInProgress", () => {
  it("dispatch with no later outcome, inside grace → in cycle", () => {
    const logText = [
      `${minutesAgoIso(40)} tick pr=154 threads=0 idle`,
      `${minutesAgoIso(20)} tick pr=154 threads=1 dispatched=4295962800`,
    ].join("\n");
    expect(isCycleInProgress({ logText: logText, nowMs: NOW_MS })).toBe(true);
  });

  it("outcome line after the dispatch → cycle finished", () => {
    const logText = [
      `${minutesAgoIso(20)} tick pr=154 threads=1 dispatched=4295962800`,
      `${minutesAgoIso(5)} muggle-do cycle review_ids=[4295962800] outcome=pushed head_sha=abc1234`,
    ].join("\n");
    expect(isCycleInProgress({ logText: logText, nowMs: NOW_MS })).toBe(false);
  });

  it("dispatch older than the grace window → presumed crashed, not in cycle", () => {
    const logText = `${minutesAgoIso(120)} tick pr=154 threads=1 dispatched=4295962800`;
    expect(isCycleInProgress({ logText: logText, nowMs: NOW_MS })).toBe(false);
  });

  it("idle-only log → not in cycle", () => {
    const logText = `${minutesAgoIso(3)} tick pr=154 threads=0 idle`;
    expect(isCycleInProgress({ logText: logText, nowMs: NOW_MS })).toBe(false);
  });

  it("the watchdog's own spawn line is not a dispatch", () => {
    const logText = `${minutesAgoIso(3)} watchdog spawned recovery tick pr=154 reason=confirmed-signal`;
    expect(isCycleInProgress({ logText: logText, nowMs: NOW_MS })).toBe(false);
  });
});
