import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
import {
  WatcherRecoveryOutcome,
  WatchEventKind,
  WatchFindingCode,
  ReloadAction,
  type CommandOutcome,
  type WatchTickDeps,
} from "../../watch/types.js";
import {
  createDefaultWatchTickDeps,
  loadLastWatchSnapshot,
  registerWatchSlot,
  runReloadPluginsPass,
  runWatchTick,
  unregisterWatchSlot,
} from "../../watch/watch-service.js";
import { makeTempDir, makeWatchPaths, openPrEntry, scriptedRunner, succeeded, writeSlot } from "./fixtures.js";

const NOW_MS = Date.parse("2026-10-24T12:00:00Z");
const HOUR_MS = 3_600_000;

interface MachineState {
  claudeListing: unknown[] | null;
  psOutput: string;
  prNodesByNumber: Record<number, unknown>;
}

// Answers each edge the tick calls the way the real tools would.
function machineAnswer(machine: MachineState): (executable: string, args: string[]) => CommandOutcome | null {
  return (executable, args) => {
    if (executable === "ps") return succeeded(machine.psOutput);
    if (executable === "claude" && args[0] === "agents") {
      return machine.claudeListing === null ? null : succeeded(JSON.stringify(machine.claudeListing));
    }
    if (executable === "claude") return succeeded("ok");
    if (executable === "gh") {
      const numbers = args.filter((arg) => /^n\d+=/.test(arg)).map((arg) => Number(arg.split("=")[1]));
      const answered = Object.fromEntries(numbers.map((prNumber, index) => [`p${index}`, { pullRequest: machine.prNodesByNumber[prNumber] ?? null }]));
      return succeeded(JSON.stringify({ data: answered }));
    }
    return null;
  };
}

function writePlugins(pluginsFile: string, version: string): void {
  mkdirSync(dirname(pluginsFile), { recursive: true });
  writeFileSync(pluginsFile, JSON.stringify({ plugins: { "muggleai@works": [{ scope: "user", version: version, gitCommitSha: "c", lastUpdated: "2026-10-24T11:00:00.000Z" }] } }));
}

function buildMachine() {
  const root = makeTempDir("watch-service");
  const paths = makeWatchPaths(root);
  const projectCwd = join(root, "repo");
  mkdirSync(projectCwd);
  mkdirSync(join(paths.claudeProjectsDir, "repo"), { recursive: true });
  writeFileSync(join(paths.claudeProjectsDir, "repo", "owner-gone.jsonl"), `${JSON.stringify({ cwd: projectCwd })}\n`);
  writeSlot(paths.slotsDir, "red-pr", {
    prsJson: [openPrEntry("o/r", 1)],
    ownerSessionId: "owner-gone",
    heartbeatMtimeMs: NOW_MS - 2 * HOUR_MS,
    isRegistered: true,
  });
  writeSlot(paths.slotsDir, "watched", {
    prsJson: [openPrEntry("o/r", 2)],
    ownerSessionId: "owner-live",
    heartbeatMtimeMs: NOW_MS - 30_000,
    isRegistered: true,
  });
  writePlugins(paths.claudeInstalledPluginsFile, "1.0.0");
  const machine: MachineState = {
    claudeListing: [
      { id: "owner-li", sessionId: "owner-live", kind: "background", status: "busy", state: "working", startedAt: NOW_MS - 2 * HOUR_MS },
      { id: "idle-bg1", sessionId: "idle-bg", kind: "background", status: "idle", state: "blocked", startedAt: NOW_MS - 2 * HOUR_MS },
      { id: "terminal", sessionId: "terminal-1", kind: "interactive", status: "idle", name: "my terminal", startedAt: NOW_MS - 2 * HOUR_MS },
    ],
    psOutput: [
      `  50     1   02:00 /bin/bash /p/pr-watch-loop.sh --slot ${paths.slotsDir}/watched --repo o/r --pr 2 --base main`,
      "  60     1   05:00 /usr/bin/node /g/@muggleai/works/bin/muggle.js serve",
    ].join("\n"),
    prNodesByNumber: {
      1: { state: "OPEN", headRefOid: "head1", commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } },
      2: { state: "OPEN", headRefOid: "head2", mergeStateStatus: "CLEAN" },
    },
  };
  const runner = scriptedRunner((executable, args) => machineAnswer(machine)(executable, args));
  const notifications: string[][] = [];
  const deps: WatchTickDeps = {
    nowMs: NOW_MS,
    platform: "linux",
    paths: paths,
    runCommand: runner.runCommand,
    notify: (_, lines) => notifications.push(lines),
    isAutoReloadEnabled: true,
    isRecoveryEnabled: true,
  };
  return { paths: paths, machine: machine, runner: runner, notifications: notifications, deps: deps, projectCwd: projectCwd };
}

function readEvents(watchDir: string): Array<{ kind: WatchEventKind; code?: WatchFindingCode }> {
  return readFileSync(join(watchDir, "events.jsonl"), "utf-8").trim().split("\n").map((line) => JSON.parse(line));
}

describe("runWatchTick", () => {
  it("records findings, resumes a dead registered watcher's owner, and notifies once", () => {
    const { deps, runner, notifications, paths, projectCwd } = buildMachine();
    const snapshot = runWatchTick(deps);

    expect(snapshot.sessions).toHaveLength(3);
    expect(snapshot.slots.map((slot) => [slot.slug, slot.watcher])).toEqual([["red-pr", "dead"], ["watched", "polling"]]);
    expect(snapshot.findings.map((current) => current.code).sort()).toEqual(
      [WatchFindingCode.CiFailing, WatchFindingCode.OrphanedMcpServer, WatchFindingCode.WatcherDead].sort(),
    );
    expect(snapshot.recoveries).toEqual([
      { ownerSessionId: "owner-gone", slotSlugs: ["red-pr"], outcome: WatcherRecoveryOutcome.Resumed, cwd: projectCwd },
    ]);
    expect(runner.calls.filter((call) => call.args[0] === "--resume")).toHaveLength(1);
    expect(snapshot.reload).toBeUndefined();

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("Resumed session owner-go to re-arm red-pr");
    expect(readEvents(paths.watchDir).map((event) => event.kind)).toEqual([
      WatchEventKind.Raised,
      WatchEventKind.Raised,
      WatchEventKind.Raised,
      WatchEventKind.Resumed,
    ]);
    expect(loadLastWatchSnapshot(paths)?.takenAt).toBe(new Date(NOW_MS).toISOString());
    const state = JSON.parse(readFileSync(join(paths.watchDir, "state.json"), "utf-8"));
    expect(Object.keys(state.activeFindings)).toHaveLength(3);
    expect(state.recoveryAttemptsByOwner["owner-gone"]).toHaveLength(1);
    expect(state.pluginFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stays quiet on an unchanged second tick and holds the owner in its cooldown", () => {
    const { deps, runner, notifications } = buildMachine();
    runWatchTick(deps);
    const second = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });
    expect(notifications).toHaveLength(1);
    expect(second.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.CoolingDown);
    expect(runner.calls.filter((call) => call.args[0] === "--resume")).toHaveLength(1);
  });

  it("caches a merged PR and clears its findings", () => {
    const { deps, machine, paths } = buildMachine();
    runWatchTick(deps);
    machine.prNodesByNumber[1] = { state: "MERGED" };
    const second = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });
    expect(second.findings.map((current) => current.code)).toContain(WatchFindingCode.SlotTerminalUnfinalized);
    expect(readEvents(paths.watchDir).filter((event) => event.kind === WatchEventKind.Cleared).length).toBeGreaterThanOrEqual(2);
    const third = runWatchTick({ ...deps, nowMs: NOW_MS + 240_000 });
    expect(third.slots.find((slot) => slot.slug === "red-pr")?.live?.state).toBe("MERGED");
  });

  it("fans a plugin change out: respawns idle background sessions, defers busy ones, names terminals", () => {
    const { deps, runner, notifications, paths } = buildMachine();
    runWatchTick(deps);
    writePlugins(paths.claudeInstalledPluginsFile, "1.0.1");
    const afterChange = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });
    expect(runner.calls.filter((call) => call.args[0] === "respawn").map((call) => call.args[1])).toEqual(["idle-bg1"]);
    expect(afterChange.reload?.decisions.map((decision) => [decision.sessionId, decision.action])).toEqual([
      ["owner-live", ReloadAction.Defer],
      ["idle-bg", ReloadAction.Respawn],
      ["terminal-1", ReloadAction.NotifyManual],
    ]);
    expect(notifications[notifications.length - 1]).toEqual(["Plugins changed — run /reload-plugins in: my terminal"]);
    const state = JSON.parse(readFileSync(join(paths.watchDir, "state.json"), "utf-8"));
    expect(state.pendingReload).toMatchObject({ respawnedSessionIds: ["idle-bg"], notifiedSessionIds: ["terminal-1"] });
    expect(readEvents(paths.watchDir).map((event) => event.kind)).toEqual(
      expect.arrayContaining([WatchEventKind.ReloadRequested, WatchEventKind.Respawned]),
    );
  });

  it("starts no fan-out with auto-reload off, and acts on nothing without a session listing", () => {
    const { deps, runner, paths } = buildMachine();
    runWatchTick({ ...deps, isAutoReloadEnabled: false });
    writePlugins(paths.claudeInstalledPluginsFile, "2.0.0");
    expect(runWatchTick({ ...deps, isAutoReloadEnabled: false, nowMs: NOW_MS + 120_000 }).reload).toBeUndefined();

    const { deps: freshDeps, runner: freshRunner, machine: freshMachine } = buildMachine();
    freshMachine.claudeListing = null;
    const blind = runWatchTick(freshDeps);
    expect(blind.recoveries).toEqual([]);
    expect(blind.slots[0].isOwnerSessionActive).toBeUndefined();
    expect(freshRunner.calls.some((call) => call.args[0] === "--resume")).toBe(false);
    expect(runner.calls.some((call) => call.args[0] === "respawn")).toBe(false);
  });

  it("reports without resuming when recovery is off", () => {
    const { deps, runner } = buildMachine();
    expect(runWatchTick({ ...deps, isRecoveryEnabled: false }).recoveries).toEqual([]);
    expect(runner.calls.some((call) => call.args[0] === "--resume")).toBe(false);
  });

  it("judges by heartbeat alone when the process table cannot be read", () => {
    const { deps, machine } = buildMachine();
    machine.psOutput = "";
    const snapshot = runWatchTick({ ...deps, runCommand: (executable, args, options) => (executable === "ps" ? null : deps.runCommand(executable, args, options)) });
    expect(snapshot.processes).toEqual([]);
    expect(snapshot.slots.map((slot) => slot.watcher)).toEqual(["dead", "polling"]);
  });
});

describe("runReloadPluginsPass", () => {
  it("previews without respawning or writing state", () => {
    const { deps, runner, paths } = buildMachine();
    const preview = runReloadPluginsPass(deps, true);
    expect(preview?.decisions.find((decision) => decision.sessionId === "idle-bg")?.action).toBe(ReloadAction.Respawn);
    expect(runner.calls.some((call) => call.args[0] === "respawn")).toBe(false);
    expect(existsSync(join(paths.watchDir, "state.json"))).toBe(false);
  });

  it("respawns now and leaves busy sessions pending for later ticks", () => {
    const { deps, runner, paths, notifications } = buildMachine();
    const report = runReloadPluginsPass(deps, false);
    expect(report?.respawnedSessionIds).toEqual(["idle-bg"]);
    expect(runner.calls.filter((call) => call.args[0] === "respawn")).toHaveLength(1);
    expect(notifications).toEqual([["Plugins changed — run /reload-plugins in: my terminal"]]);
    const state = JSON.parse(readFileSync(join(paths.watchDir, "state.json"), "utf-8"));
    expect(state.pendingReload.changedAtMs).toBe(NOW_MS);
    expect(readEvents(paths.watchDir)[0].kind).toBe(WatchEventKind.ReloadRequested);
  });

  it("returns null when Claude's sessions cannot be listed", () => {
    const { deps, machine } = buildMachine();
    machine.claudeListing = null;
    expect(runReloadPluginsPass(deps, false)).toBeNull();
  });

  it("finishes the fan-out in one pass when nothing is busy", () => {
    const { deps, machine, paths } = buildMachine();
    machine.claudeListing = [{ id: "idle-bg1", sessionId: "idle-bg", kind: "background", status: "idle", state: "blocked", startedAt: 1 }];
    // An unreadable install record still allows a manual pass.
    writeFileSync(paths.claudeInstalledPluginsFile, "{");
    runReloadPluginsPass(deps, false);
    expect(JSON.parse(readFileSync(join(paths.watchDir, "state.json"), "utf-8")).pendingReload).toBeUndefined();
  });
});

describe("slot registration through the service", () => {
  it("registers and unregisters a slot by its dir", () => {
    const slotDir = writeSlot(join(makeTempDir("slots"), "sessions"), "csv", { prsJson: [openPrEntry("o/r", 1)] });
    registerWatchSlot(slotDir, new Date(NOW_MS));
    expect(JSON.parse(readFileSync(join(slotDir, "watch-registration.json"), "utf-8")).registered_by).toBe("muggle-watch-cli");
    expect(unregisterWatchSlot(slotDir)).toBe(true);
    expect(unregisterWatchSlot(slotDir)).toBe(false);
  });
});

describe("createDefaultWatchTickDeps", () => {
  it("wires the real edges with the requested switches", () => {
    const deps = createDefaultWatchTickDeps({ isAutoReloadEnabled: false, isRecoveryEnabled: true });
    expect(deps.platform).toBe(process.platform);
    expect(deps.isAutoReloadEnabled).toBe(false);
    expect(deps.isRecoveryEnabled).toBe(true);
    expect(deps.paths.watchDir).toMatch(/[\\/]\.muggle-ai[\\/]watch$/);
  });
});
