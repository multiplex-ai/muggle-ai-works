import { beforeAll, describe, expect, it } from "vitest";
import { EVENT_HOOK_RUNTIME_BUDGET_MS, HOOK_RUNTIME_BUDGET_MS } from "../../../hook-budget/constants.js";
import { HOOK_RUNTIME_SCENARIOS, HOOK_TIMEOUT_CAPS, RUNTIME_MEASUREMENT_TIMEOUT_MS } from "./constants.js";
import { commandsForSlot, groupFiresForSlot, loadHooksManifest } from "./footprint.js";
import { createSlowProgramShimDirectory, timeScenarioRuntime, waitForUpkeepSweeps } from "./runtime.js";
import { HomeSeed, type HookEvent } from "./types.js";

// Hooks fire on every tool call, prompt and turn end, so a slow one is paid for constantly. The harness kills a
// hook at its declared timeout, which makes the timeout the hard cap; the timed firings hold each hook inside it
// with the network and installer programs stalled, so a hook that waits on one fails here, not on a user's machine.
const manifest = loadHooksManifest();
const scenarioRows = HOOK_RUNTIME_SCENARIOS.map((scenario) => [scenario.label, scenario] as const);

describe("hook runtime caps in the manifest", () => {
  it("every hook declares a timeout within its event's per-hook cap", () => {
    for (const [event, groups] of Object.entries(manifest.hooks)) {
      const caps = HOOK_TIMEOUT_CAPS[event as HookEvent];
      for (const hook of groups.flatMap((group) => group.hooks)) {
        expect(hook.timeout, `"${hook.command}" declares no timeout`).toBeTypeOf("number");
        expect(hook.timeout, `${event} "${hook.command}" timeout`).toBeLessThanOrEqual(caps.perHookSeconds);
      }
    }
  });

  it.each(scenarioRows)("%s: the hooks it fires declare no more between them than their event's per-firing cap", (label, scenario) => {
    const declaredSeconds = commandsForSlot(manifest, scenario.slot, scenario.payload).reduce(
      (sum, hook) => sum + (hook.timeout ?? 0),
      0,
    );
    expect(declaredSeconds, `${label} summed timeouts`).toBeLessThanOrEqual(HOOK_TIMEOUT_CAPS[scenario.slot.event].perFiringSeconds);
  });

  it("every hook group is fired by at least one timed scenario", () => {
    for (const [event, groups] of Object.entries(manifest.hooks)) {
      groups.forEach((group, index) => {
        const isCovered = HOOK_RUNTIME_SCENARIOS.some(
          (scenario) => scenario.slot.event === event && groupFiresForSlot(group, scenario.slot),
        );
        expect(isCovered, `${event} group ${index} (${group.matcher ?? "no matcher"}) has no scenario in HOOK_RUNTIME_SCENARIOS`).toBe(true);
      });
    }
  });
});

describe("hook runtime budget", () => {
  let slowShimDirectory: string;
  beforeAll(() => {
    slowShimDirectory = createSlowProgramShimDirectory();
  });

  it.each(scenarioRows)(
    `%s: each hook answers within ${HOOK_RUNTIME_BUDGET_MS}ms and all within ${EVENT_HOOK_RUNTIME_BUDGET_MS}ms`,
    async (label, scenario) => {
      const { commandRuntimes, homes } = timeScenarioRuntime(manifest, scenario, slowShimDirectory);
      // The upkeep a due start detaches must outlive the hook, and must be done before the next scenario is timed.
      if (scenario.homeSeed === HomeSeed.ColdCaches) {
        expect(await waitForUpkeepSweeps(homes), `${label}: the detached upkeep never finished its sweep`).toBe(true);
      }
      for (const runtime of commandRuntimes) {
        const runs = runtime.runsMs.map(Math.round).join(", ");
        expect(runtime.medianMs, `${label}: "${runtime.command}" median (runs: ${runs}ms)`).toBeLessThanOrEqual(HOOK_RUNTIME_BUDGET_MS);
      }
      const totalMs = commandRuntimes.reduce((sum, runtime) => sum + runtime.medianMs, 0);
      expect(totalMs, `${label}: summed median of ${commandRuntimes.length} hooks`).toBeLessThanOrEqual(EVENT_HOOK_RUNTIME_BUDGET_MS);
    },
    RUNTIME_MEASUREMENT_TIMEOUT_MS,
  );
});
