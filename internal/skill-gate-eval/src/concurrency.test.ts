import { describe, expect, it } from "vitest";

import {
  computeThrottleBackoffMs,
  isThrottleError,
  runWithConcurrencyLimit,
  ThrottleGate,
  withThrottleRetry,
} from "./concurrency.js";
import {
  THROTTLE_BACKOFF_BASE_MS,
  THROTTLE_BACKOFF_CAP_MS,
} from "./constants.js";

function manualClock(): { now: () => number; sleep: (ms: number) => Promise<void>; time: () => number } {
  let currentMs = 0;
  return {
    now: () => currentMs,
    sleep: (ms: number) => {
      currentMs += ms;
      return Promise.resolve();
    },
    time: () => currentMs,
  };
}

describe("isThrottleError", () => {
  it.each([
    "API error: 429 Too Many Requests",
    "rate limit exceeded, retry later",
    "Overloaded",
    "You have reached your usage limit",
    "server responded with 529",
  ])("classifies %j as throttle", (message) => {
    expect(isThrottleError(new Error(message))).toBe(true);
  });

  it("does not classify ordinary failures as throttle", () => {
    expect(isThrottleError(new Error("Claude Code process exited with code 1"))).toBe(false);
    expect(isThrottleError(new Error("ENOENT: no such file"))).toBe(false);
  });
});

describe("computeThrottleBackoffMs", () => {
  it("grows exponentially with zero jitter", () => {
    expect(computeThrottleBackoffMs(1, () => 0)).toBe(THROTTLE_BACKOFF_BASE_MS);
    expect(computeThrottleBackoffMs(2, () => 0)).toBe(THROTTLE_BACKOFF_BASE_MS * 2);
    expect(computeThrottleBackoffMs(3, () => 0)).toBe(THROTTLE_BACKOFF_BASE_MS * 4);
  });

  it("caps at THROTTLE_BACKOFF_CAP_MS", () => {
    expect(computeThrottleBackoffMs(10, () => 0.999)).toBe(THROTTLE_BACKOFF_CAP_MS);
  });
});

describe("ThrottleGate", () => {
  it("waits out a reported cooldown and keeps the max of concurrent reports", async () => {
    const clock = manualClock();
    const gate = new ThrottleGate(clock.now, clock.sleep);
    gate.reportThrottle(5_000);
    gate.reportThrottle(2_000);
    await gate.waitUntilClear();
    expect(clock.time()).toBe(5_000);
  });

  it("returns immediately when no cooldown is active", async () => {
    const clock = manualClock();
    const gate = new ThrottleGate(clock.now, clock.sleep);
    await gate.waitUntilClear();
    expect(clock.time()).toBe(0);
  });
});

describe("withThrottleRetry", () => {
  const instantGate = () => {
    const clock = manualClock();
    return new ThrottleGate(clock.now, clock.sleep);
  };

  it("retries a throttled run and returns the eventual success", async () => {
    let calls = 0;
    const result = await withThrottleRetry(
      () => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("429 rate limit"));
        return Promise.resolve("ok");
      },
      { gate: instantGate(), computeBackoffMs: () => 1 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("propagates non-throttle errors without retrying", async () => {
    let calls = 0;
    await expect(
      withThrottleRetry(
        () => {
          calls++;
          return Promise.reject(new Error("scenario file missing"));
        },
        { gate: instantGate(), computeBackoffMs: () => 1 },
      ),
    ).rejects.toThrow("scenario file missing");
    expect(calls).toBe(1);
  });

  it("gives up after maxRetries throttle failures", async () => {
    let calls = 0;
    await expect(
      withThrottleRetry(
        () => {
          calls++;
          return Promise.reject(new Error("overloaded"));
        },
        { gate: instantGate(), maxRetries: 2, computeBackoffMs: () => 1 },
      ),
    ).rejects.toThrow("overloaded");
    expect(calls).toBe(3);
  });

  it("reports each backoff through onThrottle", async () => {
    const observedAttempts: number[] = [];
    let calls = 0;
    await withThrottleRetry(
      () => {
        calls++;
        if (calls <= 2) return Promise.reject(new Error("rate limit"));
        return Promise.resolve("done");
      },
      {
        gate: instantGate(),
        computeBackoffMs: () => 1,
        onThrottle: (attempt) => observedAttempts.push(attempt),
      },
    );
    expect(observedAttempts).toEqual([1, 2]);
  });
});

describe("runWithConcurrencyLimit", () => {
  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const jobs = Array.from({ length: 8 }, () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return maxActive;
    });
    await runWithConcurrencyLimit(jobs, 3);
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("returns results in job order regardless of completion order", async () => {
    const delaysMs = [30, 5, 20, 1];
    const jobs = delaysMs.map((delayMs, jobIndex) => async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return jobIndex;
    });
    const results = await runWithConcurrencyLimit(jobs, 4);
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it("runs everything with a limit larger than the job count", async () => {
    const results = await runWithConcurrencyLimit(
      [async () => "a", async () => "b"],
      16,
    );
    expect(results).toEqual(["a", "b"]);
  });

  it("rejects when a job rejects", async () => {
    const jobs = [
      async () => "fine",
      async () => {
        throw new Error("boom");
      },
    ];
    await expect(runWithConcurrencyLimit(jobs, 2)).rejects.toThrow("boom");
  });
});
