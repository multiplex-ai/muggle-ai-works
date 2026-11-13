import { describe, expect, it } from "vitest";
import { recordRestartAttempts, restartsWithinWindow } from "../../watch/restart-plan.js";

const NOW_MS = Date.parse("2026-11-13T08:00:00Z");
const WINDOW_MS = 24 * 60 * 60_000;

describe("restartsWithinWindow", () => {
  it("keeps restarts inside the window and drops unreadable entries", () => {
    const inside = new Date(NOW_MS - 60_000).toISOString();
    const outside = new Date(NOW_MS - WINDOW_MS).toISOString();
    expect(restartsWithinWindow({ session: [outside, "garbled", inside] }, "session", NOW_MS, WINDOW_MS)).toEqual([NOW_MS - 60_000]);
    expect(restartsWithinWindow({}, "unknown", NOW_MS, WINDOW_MS)).toEqual([]);
  });
});

describe("recordRestartAttempts", () => {
  it("adds every attempted restart and drops ones outside the window", () => {
    const old = new Date(NOW_MS - WINDOW_MS - 1).toISOString();
    const kept = new Date(NOW_MS - 60_000).toISOString();
    const recorded = recordRestartAttempts(
      { stale: [old], kept: [old, kept] },
      { decisions: [], respawnedSessionIds: ["kept", "new"], failedSessionIds: ["failed"], untrustedSessionIds: ["refused"] },
      NOW_MS,
      WINDOW_MS,
    );
    const nowIso = new Date(NOW_MS).toISOString();
    expect(recorded).toEqual({ kept: [kept, nowIso], new: [nowIso], failed: [nowIso], refused: [nowIso] });
  });
});
