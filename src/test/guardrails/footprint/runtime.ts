import { spawnSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { performance } from "perf_hooks";
import { setTimeout as sleep } from "timers/promises";
import {
  HOME_SEED_SESSION_STATES,
  HOOK_RUNTIME_TIMING_RUNS,
  PLUGIN_ROOT,
  RUNTIME_SESSION_ID,
  SLOW_PROGRAMS,
  SLOW_PROGRAM_STALL_SECONDS,
  UPKEEP_NOT_DUE_SECONDS,
  UPKEEP_SETTLE_POLL_MS,
  UPKEEP_SETTLE_TIMEOUT_MS,
} from "./constants.js";
import { commandsForSlot, hookPayloadJson, toBashPathArg } from "./footprint.js";
import { HomeSeed, type HookRuntimeScenario, type HooksManifest, type ScenarioRuntime } from "./types.js";

/**
 * Builds a directory holding one stand-in per SLOW_PROGRAMS entry that stalls for SLOW_PROGRAM_STALL_SECONDS and
 * fails. Put first on PATH, it makes any hook that waits on the network or an install blow its budget. Each
 * stand-in execs `sleep`, so a timeout that kills it leaves no grandchild holding the hook's pipes open.
 */
export function createSlowProgramShimDirectory(): string {
  const shimDirectory = mkdtempSync(join(tmpdir(), "runtime-slow-shims-"));
  for (const program of SLOW_PROGRAMS) {
    const shimPath = join(shimDirectory, program);
    writeFileSync(shimPath, `#!/usr/bin/env bash\nexec sleep ${SLOW_PROGRAM_STALL_SECONDS}\n`);
    chmodSync(shimPath, 0o755);
  }
  return shimDirectory;
}

function seedScenarioHome(homeSeed: HomeSeed): string {
  const home = mkdtempSync(join(tmpdir(), "runtime-home-"));
  const guardrailsDirectory = join(home, ".muggle-ai", "guardrails");
  mkdirSync(guardrailsDirectory, { recursive: true });
  if (homeSeed !== HomeSeed.ColdCaches) {
    const cacheDirectory = join(home, ".cache", "muggle");
    mkdirSync(cacheDirectory, { recursive: true });
    writeFileSync(join(cacheDirectory, "electron-app-checked"), "");
    writeFileSync(join(cacheDirectory, "version-check"), "1.0.0|1.0.0");
    writeFileSync(join(cacheDirectory, "session-maintenance-due"), `${Math.floor(Date.now() / 1_000) + UPKEEP_NOT_DUE_SECONDS}\n`);
  }
  const sessionState = HOME_SEED_SESSION_STATES[homeSeed];
  if (sessionState) {
    writeFileSync(join(guardrailsDirectory, `${RUNTIME_SESSION_ID}.json`), JSON.stringify(sessionState, null, 2));
  }
  return home;
}

/**
 * Waits until the upkeep each home's session start launched has finished its state sweep, the part that starts
 * processes; what follows only waits on the stalled stand-ins.
 * @returns Whether every sweep finished before UPKEEP_SETTLE_TIMEOUT_MS.
 */
export async function waitForUpkeepSweeps(homes: string[]): Promise<boolean> {
  const settleBy = Date.now() + UPKEEP_SETTLE_TIMEOUT_MS;
  const isSwept = (home: string): boolean => existsSync(join(home, ".cache", "muggle", "state-gc-checked"));
  while (!homes.every(isSwept)) {
    if (Date.now() > settleBy) return false;
    await sleep(UPKEEP_SETTLE_POLL_MS);
  }
  return true;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Fires every command of a scenario's slot HOOK_RUNTIME_TIMING_RUNS times, each run in a freshly seeded home, with
 * SLOW_PROGRAMS stalled and the `gh` provider switched on so the hook's real lookups run into the stall.
 *
 * Output shape: `{ commandRuntimes: [{ command: "bash \"${CLAUDE_PLUGIN_ROOT}/scripts/guardrail-dispatch.sh\" …", medianMs: 212, runsMs: [230, 212, 198] }], homes: ["/tmp/runtime-home-a1b2c3", …] }`
 */
export function timeScenarioRuntime(
  manifest: HooksManifest,
  scenario: HookRuntimeScenario,
  slowShimDirectory: string,
): ScenarioRuntime {
  const commands = commandsForSlot(manifest, scenario.slot, scenario.payload);
  const runsMs: number[][] = commands.map(() => []);
  const homes: string[] = [];
  const slowShimPathForBash = toBashPathArg(slowShimDirectory);
  const pluginRootForBash = toBashPathArg(PLUGIN_ROOT);
  for (let run = 0; run < HOOK_RUNTIME_TIMING_RUNS; run += 1) {
    const home = seedScenarioHome(scenario.homeSeed);
    homes.push(home);
    const payload = hookPayloadJson(scenario.payload, home);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: pluginRootForBash };
    delete env.MUGGLE_GUARDRAIL_GH_CALLS;
    commands.forEach((command, index) => {
      const startedAt = performance.now();
      spawnSync("bash", ["-c", `PATH='${slowShimPathForBash}':"$PATH"; ${command.command}`], {
        input: payload,
        cwd: home,
        env: env,
        encoding: "utf-8",
      });
      runsMs[index].push(performance.now() - startedAt);
    });
  }
  const commandRuntimes = commands.map((command, index) => ({
    command: command.command,
    medianMs: medianOf(runsMs[index]),
    runsMs: runsMs[index],
  }));
  return { commandRuntimes: commandRuntimes, homes: homes };
}
