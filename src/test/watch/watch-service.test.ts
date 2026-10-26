import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
import { MUGGLE_PLUGIN_ID, RECOVERY_RESUME_PROMPT, SESSION_EXIT_WAIT_MS, TRUST_PROBE_SESSION_NAME } from "../../watch/constants.js";
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
const PROBE_ID = "probe01";

interface MachineState {
  claudeListing: unknown[] | null;
  psOutput: string;
  prNodesByNumber: Record<number, unknown>;
  /** Workspaces where a background launch is refused. */
  untrustedCwds: Set<string>;
  registryDir: string;
  /** Sessions whose process outlives `claude stop`. */
  unstoppableShortIds: Set<string>;
}

// A stopped session stays listed, with no turn status and no registry entry.
function stopSession(machine: MachineState, shortId: string): void {
  if (machine.unstoppableShortIds.has(shortId)) return;
  const stopped = (machine.claudeListing ?? []).find((listing) => (listing as { id?: string }).id === shortId) as { sessionId?: string; status?: string } | undefined;
  if (!stopped) return;
  delete stopped.status;
  for (const fileName of readdirSync(machine.registryDir)) {
    const entry = JSON.parse(readFileSync(join(machine.registryDir, fileName), "utf-8")) as { sessionId?: string };
    if (entry.sessionId === stopped.sessionId) rmSync(join(machine.registryDir, fileName));
  }
}

// Answers each edge the tick calls the way the real tools would.
function machineAnswer(machine: MachineState): (executable: string, args: string[], cwd?: string) => CommandOutcome | null {
  return (executable, args, cwd) => {
    if (executable === "ps") return succeeded(machine.psOutput);
    if (executable === "claude" && args[0] === "agents") {
      return machine.claudeListing === null ? null : succeeded(JSON.stringify(machine.claudeListing));
    }
    if (executable === "claude" && args[0] === "stop") stopSession(machine, args[1]);
    if (executable === "claude" && args[0] === "--bg") {
      return cwd && machine.untrustedCwds.has(cwd) ? { exitCode: 1, stdout: "" } : succeeded(`backgrounded · ${PROBE_ID} · ${TRUST_PROBE_SESSION_NAME}`);
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

function writePlugins(pluginsFile: string, updatedAtMs: number): void {
  mkdirSync(dirname(pluginsFile), { recursive: true });
  const install = { scope: "user", version: "1", gitCommitSha: "c", lastUpdated: new Date(updatedAtMs).toISOString() };
  writeFileSync(pluginsFile, JSON.stringify({ plugins: { [MUGGLE_PLUGIN_ID]: [install] } }));
}

function appendInstall(installLogFile: string, atMs: number, version: string): void {
  mkdirSync(dirname(installLogFile), { recursive: true });
  const block = `Postinstall started at ${new Date(atMs).toISOString()}\nClaude plugin sync updated: loading ${version} from /g/@muggleai/works.\n`;
  writeFileSync(installLogFile, `${existsSync(installLogFile) ? readFileSync(installLogFile, "utf-8") : ""}${block}`);
}

function writeRegistry(registryDir: string, pid: number, sessionId: string): void {
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(join(registryDir, `${pid}.json`), JSON.stringify({ pid: pid, sessionId: sessionId }));
}

// Three live Claude sessions loaded two hours ago, on the build installed three hours ago.
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
  writePlugins(paths.claudeInstalledPluginsFile, NOW_MS - 3 * HOUR_MS);
  appendInstall(paths.muggleInstallLogFile, NOW_MS - 3 * HOUR_MS, "1.0.0");
  writeRegistry(paths.claudeSessionRegistryDir, 70, "owner-live");
  writeRegistry(paths.claudeSessionRegistryDir, 71, "idle-bg");
  writeRegistry(paths.claudeSessionRegistryDir, 72, "terminal-1");
  const machine: MachineState = {
    claudeListing: [
      { id: "owner-li", sessionId: "owner-live", cwd: projectCwd, kind: "background", status: "busy", state: "working", startedAt: NOW_MS - 2 * HOUR_MS },
      { id: "idle-bg1", sessionId: "idle-bg", cwd: projectCwd, kind: "background", status: "idle", state: "blocked", startedAt: NOW_MS - 2 * HOUR_MS },
      { id: "terminal", sessionId: "terminal-1", cwd: projectCwd, kind: "interactive", status: "idle", name: "my terminal", startedAt: NOW_MS - 2 * HOUR_MS },
    ],
    psOutput: [
      "  70     1   02:00:00 claude",
      "  71     1   02:00:00 claude",
      "  72     1   02:00:00 claude",
      `  50     1   02:00 /bin/bash /p/pr-watch-loop.sh --slot ${paths.slotsDir}/watched --repo o/r --pr 2 --base main`,
      "  60     1   05:00 /usr/bin/node /g/@muggleai/works/bin/muggle.js serve",
    ].join("\n"),
    prNodesByNumber: {
      1: { state: "OPEN", headRefOid: "head1", commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } },
      2: { state: "OPEN", headRefOid: "head2", mergeStateStatus: "CLEAN" },
    },
    untrustedCwds: new Set<string>(),
    registryDir: paths.claudeSessionRegistryDir,
    unstoppableShortIds: new Set<string>(),
  };
  const runner = scriptedRunner((executable, args, options) => machineAnswer(machine)(executable, args, options?.cwd));
  const notifications: string[][] = [];
  const deps: WatchTickDeps = {
    nowMs: NOW_MS,
    platform: "linux",
    paths: paths,
    runCommand: runner.runCommand,
    notify: (_, lines) => notifications.push(lines),
    isAutoReloadEnabled: true,
    isRecoveryEnabled: true,
    sleep: () => undefined,
  };
  return { paths: paths, machine: machine, runner: runner, notifications: notifications, deps: deps, projectCwd: projectCwd };
}

function readEvents(watchDir: string): Array<{ kind: WatchEventKind; code?: WatchFindingCode; message?: string }> {
  return readFileSync(join(watchDir, "events.jsonl"), "utf-8").trim().split("\n").map((line) => JSON.parse(line));
}

function readState(watchDir: string) {
  return JSON.parse(readFileSync(join(watchDir, "state.json"), "utf-8"));
}

describe("runWatchTick", () => {
  it("records findings, coverage and builds, resumes a dead registered watcher's owner, and notifies once", () => {
    const { deps, runner, notifications, paths, projectCwd } = buildMachine();
    const snapshot = runWatchTick(deps);

    expect(snapshot.installedVersion).toBe("1.0.0");
    expect(snapshot.sessions.map((session) => [session.sessionId, session.loadedAtMs, session.loadedVersion])).toEqual([
      ["owner-live", NOW_MS - 2 * HOUR_MS, "1.0.0"],
      ["idle-bg", NOW_MS - 2 * HOUR_MS, "1.0.0"],
      ["terminal-1", NOW_MS - 2 * HOUR_MS, "1.0.0"],
    ]);
    expect(snapshot.slots.map((slot) => [slot.slug, slot.watcher])).toEqual([["red-pr", "dead"], ["watched", "polling"]]);
    expect(snapshot.coverage).toEqual([{ repo: "o/r", watched: 1, deaf: 0, dead: 1 }]);
    expect(snapshot.closedOutSlugs).toEqual([]);
    expect(snapshot.findings.map((current) => current.code).sort()).toEqual(
      [WatchFindingCode.CiFailing, WatchFindingCode.OrphanedMcpServer, WatchFindingCode.WatcherDead].sort(),
    );
    expect(snapshot.recoveries).toEqual([
      { ownerSessionId: "owner-gone", slotSlugs: ["red-pr"], outcome: WatcherRecoveryOutcome.Resumed, cwd: projectCwd },
    ]);
    expect(runner.calls.filter((call) => call.args[0] === "--resume")).toHaveLength(1);
    expect(snapshot.reload?.respawnedSessionIds).toEqual([]);
    expect(runner.calls.some((call) => call.args[0] === "--bg")).toBe(false);

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("Resumed session owner-go to re-arm red-pr");
    expect(readEvents(paths.watchDir).map((event) => event.kind)).toEqual([
      WatchEventKind.Raised,
      WatchEventKind.Raised,
      WatchEventKind.Raised,
      WatchEventKind.Resumed,
    ]);
    expect(loadLastWatchSnapshot(paths)?.takenAt).toBe(new Date(NOW_MS).toISOString());
    const state = readState(paths.watchDir);
    expect(Object.keys(state.activeFindings)).toHaveLength(3);
    expect(state.recoveryAttemptsByOwner["owner-gone"]).toHaveLength(1);
  });

  it("stays quiet on an unchanged second tick and holds the owner in its cooldown", () => {
    const { deps, runner, notifications } = buildMachine();
    runWatchTick(deps);
    const second = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });
    expect(notifications).toHaveLength(1);
    expect(second.recoveries[0].outcome).toBe(WatcherRecoveryOutcome.CoolingDown);
    expect(runner.calls.filter((call) => call.args[0] === "--resume")).toHaveLength(1);
  });

  it("closes out a merged PR's slot that nobody watches, sending nothing to the PR", () => {
    const { deps, machine, paths, runner } = buildMachine();
    runWatchTick(deps);
    machine.prNodesByNumber[1] = { state: "MERGED" };
    const second = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });

    expect(second.closedOutSlugs).toEqual(["red-pr"]);
    expect(second.slots.map((slot) => slot.slug)).toEqual(["watched"]);
    expect(second.findings.map((current) => current.code)).not.toContain(WatchFindingCode.SlotTerminalUnfinalized);
    const slotDir = join(paths.slotsDir, "red-pr");
    expect(JSON.parse(readFileSync(join(slotDir, "prs.json"), "utf-8"))[0].state).toBe("merged");
    expect(readFileSync(join(slotDir, "result.md"), "utf-8")).toContain("**Final state:** merged");
    expect(readFileSync(join(slotDir, "followup.log"), "utf-8")).toMatch(/tick pr=1 terminal=merged closed-out-by=muggle-watch/);
    expect(readEvents(paths.watchDir).some((event) => event.kind === WatchEventKind.ClosedOut)).toBe(true);
    expect(runner.calls.filter((call) => call.executable === "gh").every((call) => call.args.includes("graphql"))).toBe(true);

    expect(runWatchTick({ ...deps, nowMs: NOW_MS + 240_000 }).slots.map((slot) => slot.slug)).toEqual(["watched"]);
  });

  it("leaves a merged PR's slot to its running owner, which runs the post-merge cleanup", () => {
    const { deps, machine } = buildMachine();
    machine.prNodesByNumber[2] = { state: "MERGED" };
    const snapshot = runWatchTick(deps);
    expect(snapshot.closedOutSlugs).toEqual([]);
    expect(snapshot.findings.map((current) => current.code)).toContain(WatchFindingCode.SlotTerminalUnfinalized);
  });

  it("brings sessions behind a new install onto it: restarts idle ones, defers busy ones, names terminals once", () => {
    const { deps, runner, notifications, paths, projectCwd } = buildMachine();
    runWatchTick(deps);
    appendInstall(paths.muggleInstallLogFile, NOW_MS + 60_000, "2.0.0");
    const afterInstall = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });

    expect(afterInstall.installedVersion).toBe("2.0.0");
    expect(afterInstall.reload?.decisions.map((decision) => [decision.sessionId, decision.action])).toEqual([
      ["owner-live", ReloadAction.Defer],
      ["idle-bg", ReloadAction.Respawn],
      ["terminal-1", ReloadAction.NotifyManual],
    ]);
    const probe = runner.calls.find((call) => call.args[0] === "--bg");
    expect(probe?.options?.cwd).toBe(projectCwd);
    expect(runner.calls.filter((call) => call.args[1] === PROBE_ID).map((call) => call.args[0])).toEqual(["stop", "rm"]);
    expect(runner.calls.filter((call) => call.args[0] === "respawn").map((call) => call.args[1])).toEqual(["idle-bg1"]);
    expect(notifications[notifications.length - 1]).toEqual(["Plugins changed — run /reload-plugins in: my terminal"]);
    expect(readState(paths.watchDir).pendingReload).toMatchObject({
      changedAtMs: NOW_MS + 60_000,
      respawnedSessionIds: ["idle-bg"],
      notifiedSessionIds: ["terminal-1"],
    });
    expect(readEvents(paths.watchDir).map((event) => event.kind)).toContain(WatchEventKind.Respawned);

    const notificationCount = notifications.length;
    runWatchTick({ ...deps, nowMs: NOW_MS + 240_000 });
    expect(runner.calls.filter((call) => call.args[0] === "respawn")).toHaveLength(1);
    expect(notifications).toHaveLength(notificationCount);
  });

  it("restarts nothing when only another plugin updates", () => {
    const { deps, runner, paths } = buildMachine();
    const muggleInstall = { scope: "user", version: "1", gitCommitSha: "c", lastUpdated: new Date(NOW_MS - 3 * HOUR_MS).toISOString() };
    const otherInstall = { scope: "user", version: "2", gitCommitSha: "d", lastUpdated: new Date(NOW_MS + 60_000).toISOString() };
    writeFileSync(paths.claudeInstalledPluginsFile, JSON.stringify({ plugins: { [MUGGLE_PLUGIN_ID]: [muggleInstall], "code-review@claude-plugins-official": [otherInstall] } }));
    const snapshot = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });

    expect(snapshot.reload?.decisions.every((decision) => decision.action === ReloadAction.Skip || decision.action === ReloadAction.Defer)).toBe(true);
    expect(runner.calls.some((call) => call.args[0] === "respawn" || call.args[0] === "stop")).toBe(false);
  });

  it("resumes an idle session that owns open PR watches on reconcile instead of respawning it", () => {
    const { deps, runner, paths, projectCwd } = buildMachine();
    writeSlot(paths.slotsDir, "idle-owned", { prsJson: [openPrEntry("o/r", 2)], ownerSessionId: "idle-bg", heartbeatMtimeMs: NOW_MS - 30_000 });
    runWatchTick(deps);
    appendInstall(paths.muggleInstallLogFile, NOW_MS + 60_000, "2.0.0");
    const afterInstall = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });

    expect(afterInstall.reload?.decisions.find((decision) => decision.sessionId === "idle-bg")?.action).toBe(ReloadAction.ResumeReconcile);
    expect(runner.calls.some((call) => call.args[0] === "respawn")).toBe(false);
    const resume = runner.calls.find((call) => call.args[0] === "--resume" && call.args[1] === "idle-bg");
    expect(resume?.args).toEqual(["--resume", "idle-bg", "--bg", RECOVERY_RESUME_PROMPT]);
    expect(resume?.options?.cwd).toBe(projectCwd);
    expect(runner.calls.some((call) => call.args[0] === "stop" && call.args[1] === "idle-bg1")).toBe(true);
  });

  it("resumes a watch owner from the project its transcript names, not the worktree it moved into", () => {
    const { deps, runner, paths, machine, projectCwd } = buildMachine();
    const lockedWorktree = join(projectCwd, "locked-worktree");
    mkdirSync(lockedWorktree);
    machine.untrustedCwds.add(lockedWorktree);
    machine.claudeListing = (machine.claudeListing ?? []).map((listing) =>
      (listing as { sessionId: string }).sessionId === "idle-bg" ? { ...(listing as object), cwd: lockedWorktree } : listing,
    );
    writeFileSync(join(paths.claudeProjectsDir, "repo", "idle-bg.jsonl"), `${JSON.stringify({ cwd: projectCwd })}\n`);
    writeSlot(paths.slotsDir, "idle-owned", { prsJson: [openPrEntry("o/r", 2)], ownerSessionId: "idle-bg", heartbeatMtimeMs: NOW_MS - 30_000 });
    runWatchTick(deps);
    appendInstall(paths.muggleInstallLogFile, NOW_MS + 60_000, "2.0.0");
    const afterInstall = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });

    expect(afterInstall.reload?.untrustedSessionIds).toEqual([]);
    const resume = runner.calls.find((call) => call.args[0] === "--resume" && call.args[1] === "idle-bg");
    expect(resume?.options?.cwd).toBe(projectCwd);
  });

  it("leaves a session in an untrusted workspace running, and reports it once", () => {
    const { deps, runner, notifications, paths, machine, projectCwd } = buildMachine();
    machine.untrustedCwds.add(projectCwd);
    runWatchTick(deps);
    appendInstall(paths.muggleInstallLogFile, NOW_MS + 60_000, "2.0.0");
    const afterInstall = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });

    expect(afterInstall.reload?.untrustedSessionIds).toEqual(["idle-bg"]);
    expect(runner.calls.some((call) => call.args[0] === "stop" || call.args[0] === "respawn")).toBe(false);
    expect(notifications[notifications.length - 1]).toContain("Can't restart idle-bg (workspace not trusted) — run /reload-plugins in them");
    expect(readEvents(paths.watchDir).find((event) => event.kind === WatchEventKind.RestartRefused)?.message).toContain(projectCwd);

    runWatchTick({ ...deps, nowMs: NOW_MS + 240_000 });
    expect(runner.calls.filter((call) => call.args[0] === "--bg")).toHaveLength(1);
  });

  it("continues a reload record an earlier release wrote for the same target", () => {
    const { deps, runner, paths } = buildMachine();
    appendInstall(paths.muggleInstallLogFile, NOW_MS - 60_000, "2.0.0");
    mkdirSync(paths.watchDir, { recursive: true });
    const legacyRecord = { fingerprint: "fp", changedAtMs: NOW_MS - 60_000, respawnedSessionIds: ["idle-bg"], notifiedSessionIds: [] };
    writeFileSync(join(paths.watchDir, "state.json"), JSON.stringify({ pluginFingerprint: "fp", pendingReload: legacyRecord }));
    const snapshot = runWatchTick(deps);
    expect(snapshot.reload?.decisions.find((decision) => decision.sessionId === "idle-bg")?.reason).toBe("already handled for this install");
    expect(runner.calls.some((call) => call.args[0] === "respawn")).toBe(false);
    expect(readState(paths.watchDir).pendingReload.skippedSessionIds).toEqual([]);
  });

  it("restarts nothing with auto-reload off, and acts on nothing without a session listing", () => {
    const { deps, runner, paths } = buildMachine();
    appendInstall(paths.muggleInstallLogFile, NOW_MS - 60_000, "2.0.0");
    expect(runWatchTick({ ...deps, isAutoReloadEnabled: false }).reload).toBeUndefined();
    expect(runner.calls.some((call) => call.args[0] === "respawn")).toBe(false);

    const { deps: freshDeps, runner: freshRunner, machine: freshMachine } = buildMachine();
    freshMachine.claudeListing = null;
    const blind = runWatchTick(freshDeps);
    expect(blind.recoveries).toEqual([]);
    expect(blind.reload).toBeUndefined();
    expect(blind.slots[0].isOwnerSessionActive).toBeUndefined();
    expect(freshRunner.calls.some((call) => call.args[0] === "--resume")).toBe(false);
  });

  it("stops and resumes an idle owner whose watcher died, and leaves it out of the same tick's reload", () => {
    const { deps, runner, paths, projectCwd } = buildMachine();
    writeFileSync(join(paths.claudeProjectsDir, "repo", "idle-bg.jsonl"), `${JSON.stringify({ cwd: projectCwd })}\n`);
    writeSlot(paths.slotsDir, "idle-dead", {
      prsJson: [openPrEntry("o/r", 2)],
      ownerSessionId: "idle-bg",
      heartbeatMtimeMs: NOW_MS - 2 * HOUR_MS,
      isRegistered: true,
    });
    appendInstall(paths.muggleInstallLogFile, NOW_MS - 60_000, "2.0.0");
    const snapshot = runWatchTick(deps);

    expect(snapshot.recoveries.find((recovery) => recovery.ownerSessionId === "idle-bg")).toEqual({
      ownerSessionId: "idle-bg",
      slotSlugs: ["idle-dead"],
      outcome: WatcherRecoveryOutcome.Resumed,
      cwd: projectCwd,
      ownerShortId: "idle-bg1",
    });
    const idleBgCalls = runner.calls.filter((call) => call.args.includes("idle-bg1") || call.args.includes("idle-bg")).map((call) => call.args);
    expect(idleBgCalls).toEqual([
      ["stop", "idle-bg1"],
      ["--resume", "idle-bg", "--bg", RECOVERY_RESUME_PROMPT],
    ]);
    expect(snapshot.reload?.decisions.map((decision) => decision.sessionId)).not.toContain("idle-bg");
  });

  it("gives up on an owner that outlives its stop instead of starting a copy of it", () => {
    const { deps, runner, paths, machine, projectCwd } = buildMachine();
    writeFileSync(join(paths.claudeProjectsDir, "repo", "idle-bg.jsonl"), `${JSON.stringify({ cwd: projectCwd })}\n`);
    writeSlot(paths.slotsDir, "idle-dead", { prsJson: [openPrEntry("o/r", 2)], ownerSessionId: "idle-bg", heartbeatMtimeMs: NOW_MS - 2 * HOUR_MS, isRegistered: true });
    machine.unstoppableShortIds.add("idle-bg1");
    const naps: number[] = [];
    const snapshot = runWatchTick({ ...deps, sleep: (durationMs) => naps.push(durationMs) });

    expect(snapshot.recoveries.find((recovery) => recovery.ownerSessionId === "idle-bg")?.outcome).toBe(WatcherRecoveryOutcome.ResumeFailed);
    expect(runner.calls.some((call) => call.args[0] === "--resume" && call.args[1] === "idle-bg")).toBe(false);
    expect(naps.reduce((total, durationMs) => total + durationMs, 0)).toBe(SESSION_EXIT_WAIT_MS);
  });

  it("resumes an owner that is still listed but has no process behind it", () => {
    const { deps, runner, machine } = buildMachine();
    machine.claudeListing = [...(machine.claudeListing ?? []), { id: "owner-go", sessionId: "owner-gone", kind: "background", state: "blocked" }];
    const snapshot = runWatchTick(deps);

    expect(snapshot.slots.find((slot) => slot.slug === "red-pr")?.isOwnerSessionActive).toBe(false);
    expect(snapshot.recoveries.map((recovery) => [recovery.ownerSessionId, recovery.outcome, recovery.ownerShortId])).toEqual([
      ["owner-gone", WatcherRecoveryOutcome.Resumed, undefined],
    ]);
    expect(runner.calls.some((call) => call.args[0] === "stop")).toBe(false);
  });

  it("resumes an owner on reconcile even when its PR's status could not be fetched", () => {
    const { deps, runner, paths } = buildMachine();
    writeSlot(paths.slotsDir, "idle-owned", { prsJson: [openPrEntry("o/r", 3)], ownerSessionId: "idle-bg", heartbeatMtimeMs: NOW_MS - 30_000 });
    appendInstall(paths.muggleInstallLogFile, NOW_MS - 60_000, "2.0.0");
    const snapshot = runWatchTick(deps);

    expect(snapshot.slots.find((slot) => slot.slug === "idle-owned")?.live).toBeUndefined();
    expect(snapshot.reload?.decisions.find((decision) => decision.sessionId === "idle-bg")?.action).toBe(ReloadAction.ResumeReconcile);
    expect(runner.calls.some((call) => call.args[0] === "respawn")).toBe(false);
  });

  it("reports without resuming when recovery is off", () => {
    const { deps, runner } = buildMachine();
    expect(runWatchTick({ ...deps, isRecoveryEnabled: false }).recoveries).toEqual([]);
    expect(runner.calls.some((call) => call.args[0] === "--resume")).toBe(false);
  });

  it("judges by heartbeat alone when the process table cannot be read", () => {
    const { deps } = buildMachine();
    const snapshot = runWatchTick({ ...deps, runCommand: (executable, args, options) => (executable === "ps" ? null : deps.runCommand(executable, args, options)) });
    expect(snapshot.processes).toEqual([]);
    expect(snapshot.sessions.every((session) => session.loadedAtMs === undefined)).toBe(true);
    expect(snapshot.slots.map((slot) => slot.watcher)).toEqual(["dead", "polling"]);
  });
});

describe("runReloadPluginsPass", () => {
  it("previews without restarting or writing state", () => {
    const { deps, runner, paths } = buildMachine();
    const preview = runReloadPluginsPass(deps, true);
    expect(preview?.decisions.find((decision) => decision.sessionId === "idle-bg")?.action).toBe(ReloadAction.Respawn);
    expect(runner.calls.some((call) => call.args[0] === "respawn" || call.args[0] === "--bg")).toBe(false);
    expect(existsSync(join(paths.watchDir, "state.json"))).toBe(false);
  });

  it("restarts every idle session loaded before now and leaves busy ones for later ticks", () => {
    const { deps, runner, paths, notifications } = buildMachine();
    const report = runReloadPluginsPass(deps, false);
    expect(report?.respawnedSessionIds).toEqual(["idle-bg"]);
    expect(runner.calls.filter((call) => call.args[0] === "respawn")).toHaveLength(1);
    expect(notifications).toEqual([["Plugins changed — run /reload-plugins in: my terminal"]]);
    expect(readState(paths.watchDir).pendingReload.changedAtMs).toBe(NOW_MS);
    expect(readEvents(paths.watchDir)[0].kind).toBe(WatchEventKind.ReloadRequested);
  });

  it("resumes the last snapshot's watch owners on reconcile", () => {
    const { deps, runner, paths } = buildMachine();
    writeSlot(paths.slotsDir, "idle-owned", { prsJson: [openPrEntry("o/r", 2)], ownerSessionId: "idle-bg", heartbeatMtimeMs: NOW_MS - 30_000 });
    runWatchTick({ ...deps, isAutoReloadEnabled: false });
    const report = runReloadPluginsPass({ ...deps, nowMs: NOW_MS + 60_000 }, false);
    expect(report?.decisions.find((decision) => decision.sessionId === "idle-bg")?.action).toBe(ReloadAction.ResumeReconcile);
    expect(runner.calls.some((call) => call.args[0] === "--resume" && call.args[1] === "idle-bg")).toBe(true);
  });

  it("returns null when Claude's sessions cannot be listed", () => {
    const { deps, machine } = buildMachine();
    machine.claudeListing = null;
    expect(runReloadPluginsPass(deps, false)).toBeNull();
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
    expect(deps.paths.muggleInstallLogFile).toMatch(/[\\/]\.muggle-ai[\\/]postinstall\.log$/);
  });
});
