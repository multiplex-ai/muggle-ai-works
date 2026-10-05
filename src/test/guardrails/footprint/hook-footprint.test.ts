import { beforeAll, describe, expect, it } from "vitest";
import {
  HOT_PATH_SLOT_CAPS,
  MAX_HOT_PATH_TIMEOUT_SECONDS,
  MAX_SESSION_START_TIMEOUT_SECONDS,
  MAX_TOTAL_HOOK_COMMANDS,
  NOOP_FIRING_BUDGET_MS,
  NOOP_FIRING_TIMING_RUNS,
  NOOP_FORBIDDEN_PROGRAMS,
  NOOP_MEASUREMENT_TIMEOUT_MS,
} from "./constants.js";
import {
  allHookCommands,
  commandsForSlot,
  createSpawnShimDirectory,
  loadHooksManifest,
  measureSlotFootprint,
  timeSlotNoopFiring,
} from "./footprint.js";
import { HookEvent, type HookSlotCap } from "./types.js";

// Hooks run on every tool call, prompt and turn end in every open session, so their cost is paid
// thousands of times a day on the user's machine. These caps turn the runtime-footprint design
// into a CI gate: counts are exec counts, not wall time, so they are deterministic on any runner.
const manifest = loadHooksManifest();
const slotLabel = (cap: HookSlotCap): string => `${cap.slot.event}${cap.slot.toolName ? `[${cap.slot.toolName}]` : ""}`;

function expectAtRatchet(actual: number, ceiling: number, what: string): void {
  expect(actual, `${what} rose above its ceiling ${ceiling}; keep it at or below the ceiling`).toBeLessThanOrEqual(ceiling);
  expect(actual, `${what} dropped to ${actual}; lower its ceiling in footprint/constants.ts to lock the gain in`).toBe(ceiling);
}

describe("hook manifest caps", () => {
  it("every hook declares a timeout within its event's ceiling", () => {
    for (const [event, groups] of Object.entries(manifest.hooks)) {
      const ceiling = event === HookEvent.SessionStart ? MAX_SESSION_START_TIMEOUT_SECONDS : MAX_HOT_PATH_TIMEOUT_SECONDS;
      for (const hook of groups.flatMap((group) => group.hooks)) {
        expect(hook.timeout, `${event} hook "${hook.command}" declares no timeout`).toBeTypeOf("number");
        expect(hook.timeout, `${event} hook "${hook.command}" timeout`).toBeLessThanOrEqual(ceiling);
      }
    }
  });

  it("total hook commands stay at the ratchet ceiling", () => {
    expectAtRatchet(allHookCommands(manifest).length, MAX_TOTAL_HOOK_COMMANDS, "total hook commands");
  });

  it.each(HOT_PATH_SLOT_CAPS.map((cap) => [slotLabel(cap), cap] as const))(
    "%s launches no more commands than its ceiling",
    (label, cap) => {
      expectAtRatchet(commandsForSlot(manifest, cap.slot).length, cap.maxCommands, `${label} command count`);
    },
  );
});

describe("hook no-op path caps", () => {
  let shimDirectory: string;
  beforeAll(() => {
    shimDirectory = createSpawnShimDirectory();
  });

  it.each(HOT_PATH_SLOT_CAPS.map((cap) => [slotLabel(cap), cap] as const))(
    "%s spawns nothing heavy and stays at its spawn ceiling when the event is irrelevant",
    (label, cap) => {
      const footprint = measureSlotFootprint(manifest, cap, shimDirectory);
      expect(footprint.unshimmedPrograms, `${label} ran programs the harness cannot count; add them to SHIMMED_PROGRAMS`).toEqual([]);
      const heavy = footprint.spawnedPrograms.filter((program) => NOOP_FORBIDDEN_PROGRAMS.includes(program));
      expect(heavy, `${label} started ${heavy.join(", ")} on the no-op path`).toEqual([]);
      expectAtRatchet(
        footprint.spawnedPrograms.length,
        cap.maxNoopSpawns,
        `${label} no-op spawns (${footprint.spawnedPrograms.join(" ")})`,
      );
    },
    // The counts are load-independent but the run is not: 46 serial spawns took 40s on a
    // contended Windows box, past the suite's default ceiling.
    NOOP_MEASUREMENT_TIMEOUT_MS,
  );
});

// Spawn counts are the deterministic cap; this is the felt one. Windows runners are excluded
// because their process start alone is in the budget's range, and the spawn caps above already
// hold there.
describe.skipIf(process.platform === "win32")("hook no-op path wall time", () => {
  it.each(HOT_PATH_SLOT_CAPS.map((cap) => [slotLabel(cap), cap] as const))(
    `%s answers an irrelevant event within ${NOOP_FIRING_BUDGET_MS}ms`,
    (label, cap) => {
      const firingTimes = Array.from({ length: NOOP_FIRING_TIMING_RUNS }, () => timeSlotNoopFiring(manifest, cap)).sort(
        (a, b) => a - b,
      );
      const medianMs = firingTimes[Math.floor(firingTimes.length / 2)];
      expect(medianMs, `${label} median no-op firing (runs: ${firingTimes.map(Math.round).join(", ")}ms)`).toBeLessThanOrEqual(
        NOOP_FIRING_BUDGET_MS,
      );
    },
  );
});
