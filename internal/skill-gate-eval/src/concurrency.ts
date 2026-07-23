/**
 * Bounded-concurrency pool + throttle-aware retry for eval reps.
 *
 * Every rep is an isolated agent session (its own CLI subprocess), so reps can
 * run concurrently — the only shared resource is the subscription token's rate
 * budget. The pool bounds how many sessions run at once; the throttle gate is
 * shared across the pool so one rate-limited rep pauses new starts for all of
 * them instead of letting N workers pile onto an already-throttled token.
 */

import {
  THROTTLE_BACKOFF_BASE_MS,
  THROTTLE_BACKOFF_CAP_MS,
  THROTTLE_BACKOFF_JITTER_MAX_MS,
  THROTTLE_MAX_RETRIES,
} from "./constants.js";
import type { ThrottleGateLike, ThrottleRetryOptions } from "./types.js";

const THROTTLE_SIGNATURE =
  /\b429\b|\b529\b|rate.?limit|overloaded|too many requests|usage.?limit|quota exceeded/i;

export function isThrottleError(error: unknown): boolean {
  const text =
    error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  return THROTTLE_SIGNATURE.test(text);
}

export function computeThrottleBackoffMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponentialMs = THROTTLE_BACKOFF_BASE_MS * 2 ** (attempt - 1);
  const jitterMs = Math.floor(random() * THROTTLE_BACKOFF_JITTER_MAX_MS);
  return Math.min(exponentialMs + jitterMs, THROTTLE_BACKOFF_CAP_MS);
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ThrottleGate implements ThrottleGateLike {
  private cooldownUntilEpochMs = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = sleepMs,
  ) {}

  reportThrottle(backoffMs: number): void {
    this.cooldownUntilEpochMs = Math.max(
      this.cooldownUntilEpochMs,
      this.now() + backoffMs,
    );
  }

  async waitUntilClear(): Promise<void> {
    for (;;) {
      // Re-check after every sleep: another worker may have extended the
      // cooldown while this one was waiting.
      const remainingMs = this.cooldownUntilEpochMs - this.now();
      if (remainingMs <= 0) return;
      await this.sleep(remainingMs);
    }
  }
}

/** Retries `run` on throttle-classified failures only; any other error propagates untouched. */
export async function withThrottleRetry<T>(
  run: () => Promise<T>,
  options: ThrottleRetryOptions,
): Promise<T> {
  const maxRetries = options.maxRetries ?? THROTTLE_MAX_RETRIES;
  const computeBackoffMs = options.computeBackoffMs ?? computeThrottleBackoffMs;
  for (let attempt = 1; ; attempt++) {
    await options.gate.waitUntilClear();
    try {
      return await run();
    } catch (error) {
      if (!isThrottleError(error) || attempt > maxRetries) throw error;
      const backoffMs = computeBackoffMs(attempt);
      options.gate.reportThrottle(backoffMs);
      if (options.onThrottle) options.onThrottle(attempt, backoffMs, error);
    }
  }
}

/**
 * Runs `jobs` with at most `concurrencyLimit` in flight; resolves to results
 * in job order. A job rejection propagates (fail-fast, matching the previous
 * sequential behavior); in-flight siblings finish but their results are dropped.
 */
export async function runWithConcurrencyLimit<T>(
  jobs: Array<() => Promise<T>>,
  concurrencyLimit: number,
): Promise<T[]> {
  const results = new Array<T>(jobs.length);
  let nextJobIndex = 0;
  async function drainQueue(): Promise<void> {
    for (;;) {
      const jobIndex = nextJobIndex++;
      if (jobIndex >= jobs.length) return;
      results[jobIndex] = await jobs[jobIndex]();
    }
  }
  const workerCount = Math.max(1, Math.min(concurrencyLimit, jobs.length));
  await Promise.all(Array.from({ length: workerCount }, () => drainQueue()));
  return results;
}
