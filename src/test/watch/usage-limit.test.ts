import { writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { isClaudeUsageLimitInForce } from "../../watch/usage-limit.js";
import { makeTempDir } from "./fixtures.js";

const NOW_MS = Date.parse("2026-10-29T21:38:00Z");
const HOUR_MS = 60 * 60_000;

function configWith(utilization: Record<string, unknown>): string {
  const configFile = join(makeTempDir("claude-config"), ".claude.json");
  writeFileSync(configFile, JSON.stringify({ numStartups: 4, cachedUsageUtilization: { fetchedAtMs: NOW_MS, utilization: utilization } }));
  return configFile;
}

const usageWindow = (utilization: number, resetsAtMs: number, lockedReason: string | null = null) => ({
  utilization: utilization,
  resets_at: new Date(resetsAtMs).toISOString(),
  locked_reason: lockedReason,
});

describe("isClaudeUsageLimitInForce", () => {
  it("is in force while any window is exhausted or locked and has not reset", () => {
    expect(isClaudeUsageLimitInForce(configWith({ five_hour: usageWindow(3, NOW_MS + HOUR_MS), seven_day: usageWindow(100, NOW_MS + HOUR_MS) }), NOW_MS)).toBe(true);
    expect(isClaudeUsageLimitInForce(configWith({ five_hour: usageWindow(40, NOW_MS + HOUR_MS, "spend_cap") }), NOW_MS)).toBe(true);
  });

  it("is lifted once the exhausted window's reset time has passed, however stale the cache", () => {
    expect(isClaudeUsageLimitInForce(configWith({ five_hour: usageWindow(100, NOW_MS - 60_000) }), NOW_MS)).toBe(false);
    expect(isClaudeUsageLimitInForce(configWith({ five_hour: usageWindow(3, NOW_MS + HOUR_MS), seven_day: usageWindow(21, NOW_MS + HOUR_MS) }), NOW_MS)).toBe(false);
  });

  it("ignores windows Claude leaves null and treats a missing or unreadable cache as no limit", () => {
    expect(isClaudeUsageLimitInForce(configWith({ seven_day_opus: null, five_hour: { utilization: 100 } }), NOW_MS)).toBe(false);
    expect(isClaudeUsageLimitInForce(join(makeTempDir("claude-config"), ".claude.json"), NOW_MS)).toBe(false);
    const garbled = join(makeTempDir("claude-config"), ".claude.json");
    writeFileSync(garbled, "{not json");
    expect(isClaudeUsageLimitInForce(garbled, NOW_MS)).toBe(false);
  });
});
