import { describe, expect, it } from "vitest";
import { NOOP_FIRING_BUDGET_MS, NOOP_FIRING_TIMING_BATCHES, NOOP_FIRING_TIMING_RUNS } from "./constants.js";
import { timeFiringBatches } from "./footprint.js";

// Timings a macOS CI runner recorded: one batch of Stop firings while it stalled, and one while healthy.
const STALLED_BATCH_MS = [101, 106, 111, 128, 141];
const HEALTHY_BATCH_MS = [62, 64, 65, 66, 70];
const SLOW_HOOK_BATCH_MS = [131, 134, 138, 140, 152];

function scriptedFiring(timesMs: number[]): () => number {
  let nextIndex = 0;
  return () => timesMs[nextIndex++];
}

function timeNoopBatches(timesMs: number[]) {
  return timeFiringBatches(scriptedFiring(timesMs), NOOP_FIRING_TIMING_RUNS, NOOP_FIRING_TIMING_BATCHES, NOOP_FIRING_BUDGET_MS);
}

describe("no-op firing batches", () => {
  it("passes when a runner stalled for one batch is healthy in the next", () => {
    const batches = timeNoopBatches([...STALLED_BATCH_MS, ...HEALTHY_BATCH_MS]);
    expect(batches.at(-1)?.medianMs).toBeLessThanOrEqual(NOOP_FIRING_BUDGET_MS);
  });

  it("still fails a hook over budget in every batch, after timing all of them", () => {
    const batches = timeNoopBatches(Array.from({ length: NOOP_FIRING_TIMING_BATCHES }, () => SLOW_HOOK_BATCH_MS).flat());
    expect(batches).toHaveLength(NOOP_FIRING_TIMING_BATCHES);
    expect(batches.at(-1)?.medianMs).toBeGreaterThan(NOOP_FIRING_BUDGET_MS);
  });

  it("times one batch on a healthy runner", () => {
    const batches = timeNoopBatches(HEALTHY_BATCH_MS);
    expect(batches).toEqual([{ timesMs: HEALTHY_BATCH_MS, medianMs: 65 }]);
  });
});
