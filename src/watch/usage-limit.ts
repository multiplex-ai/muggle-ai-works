import { readFileSync } from "fs";
import { USAGE_WINDOW_EXHAUSTED_PERCENT } from "./constants.js";

interface CachedUsageWindow {
  utilization?: unknown;
  resets_at?: unknown;
  locked_reason?: unknown;
}

function isUsageWindowExhausted(window: unknown, nowMs: number): boolean {
  if (typeof window !== "object" || window === null) return false;
  const { utilization, resets_at: resetsAt, locked_reason: lockedReason } = window as CachedUsageWindow;
  const resetsAtMs = typeof resetsAt === "string" ? Date.parse(resetsAt) : Number.NaN;
  // A window whose reset time has passed is open again, however stale the cache that recorded it.
  if (Number.isNaN(resetsAtMs) || resetsAtMs <= nowMs) return false;
  const isUtilizationExhausted = typeof utilization === "number" && utilization >= USAGE_WINDOW_EXHAUSTED_PERCENT;
  return isUtilizationExhausted || (lockedReason !== null && lockedReason !== undefined);
}

/**
 * Whether the account is at a usage limit that has not reset yet, per the
 * usage Claude last cached in its global config (`cachedUsageUtilization`,
 * what `/usage` shows). False when the cache is absent or unreadable.
 */
export function isClaudeUsageLimitInForce(claudeGlobalConfigFile: string, nowMs: number): boolean {
  let usageWindows: Record<string, unknown>;
  try {
    const config = JSON.parse(readFileSync(claudeGlobalConfigFile, "utf-8")) as {
      cachedUsageUtilization?: { utilization?: Record<string, unknown> };
    };
    usageWindows = config.cachedUsageUtilization?.utilization ?? {};
  } catch {
    return false;
  }
  return Object.values(usageWindows).some((usageWindow) => isUsageWindowExhausted(usageWindow, nowMs));
}
