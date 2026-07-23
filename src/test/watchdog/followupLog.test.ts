import { describe, it, expect } from "vitest";
import { isCycleInProgress, newestFollowupLogTimestampMs } from "../../watchdog/followupLog.js";

const NOW_MS = Date.parse("2026-07-23T12:00:00Z");
const MINUTE_MS = 60 * 1000;

function minutesAgoIso(minutes: number): string {
  return new Date(NOW_MS - minutes * MINUTE_MS).toISOString();
}

describe("newestFollowupLogTimestampMs", () => {
  it("returns the newest parseable line timestamp", () => {
    const logText = [
      `${minutesAgoIso(30)} tick pr=154 threads=0 idle`,
      `${minutesAgoIso(10)} tick pr=154 threads=0 idle`,
      `${minutesAgoIso(20)} tick pr=154 threads=0 idle`,
    ].join("\n");
    expect(newestFollowupLogTimestampMs(logText)).toBe(NOW_MS - 10 * MINUTE_MS);
  });

  it("returns null for empty or unparseable content", () => {
    expect(newestFollowupLogTimestampMs("")).toBeNull();
    expect(newestFollowupLogTimestampMs("no timestamp here\nnor here")).toBeNull();
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
