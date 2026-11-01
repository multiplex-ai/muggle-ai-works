import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { describe, expect, it } from "vitest";
import {
  MUGGLE_PLUGIN_ID,
  SERVICE_LOOP_DELIVERED_FILE,
  SERVICE_LOOP_OUTPUT_FILE,
  SESSION_EXIT_WAIT_MS,
  TRUST_PROBE_SESSION_NAME,
} from "../../watch/constants.js";
import {
  ServiceArmOutcome,
  WatcherRecoveryOutcome,
  WatchEventKind,
  WatchFindingCode,
  ReloadAction,
  type CommandOutcome,
  type WatchPaths,
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
const NEW_REVIEW_LINE = "EVENT pr=1 new submitted review id=42";

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

function writeRegistry(registryDir: string, pid: number, sessionId: string, fields: Record<string, unknown> = {}): void {
  mkdirSync(registryDir, { recursive: true });
  writeFileSync(join(registryDir, `${pid}.json`), JSON.stringify({ pid: pid, sessionId: sessionId, ...fields }));
}

// Remote Control at startup on, under a claude.ai login whose credentials were written at `credentialsWrittenAtMs`.
function logInWithRemoteControl(paths: WatchPaths, accountUuid: string, credentialsWrittenAtMs: number = NOW_MS - 5 * HOUR_MS): void {
  mkdirSync(dirname(paths.claudeSettingsFile), { recursive: true });
  writeFileSync(paths.claudeSettingsFile, JSON.stringify({ remoteControlAtStartup: true }));
  writeFileSync(paths.claudeGlobalConfigFile, JSON.stringify({ oauthAccount: { accountUuid: accountUuid } }));
  writeFileSync(paths.claudeCredentialsFile, "{}");
  utimesSync(paths.claudeCredentialsFile, credentialsWrittenAtMs / 1000, credentialsWrittenAtMs / 1000);
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
      1: { state: "OPEN", headRefOid: "head1", baseRefName: "main", commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } },
      2: { state: "OPEN", headRefOid: "head2", baseRefName: "main", mergeStateStatus: "CLEAN" },
    },
    untrustedCwds: new Set<string>(),
    registryDir: paths.claudeSessionRegistryDir,
    unstoppableShortIds: new Set<string>(),
  };
  const runner = scriptedRunner((executable, args, options) => machineAnswer(machine)(executable, args, options?.cwd));
  const notifications: string[][] = [];
  const launches: Array<[string, string]> = [];
  const deps: WatchTickDeps = {
    nowMs: NOW_MS,
    platform: "linux",
    paths: paths,
    runCommand: runner.runCommand,
    notify: (_, lines) => notifications.push(lines),
    isAutoReloadEnabled: true,
    isRecoveryEnabled: true,
    isRemoteControlKeptOn: true,
    // Stands in for the detached loop: it shows in the process table and names the watch as its listener.
    launchServiceLoop: (slotDir, pr, baseBranch) => {
      launches.push([basename(slotDir), baseBranch]);
      machine.psOutput += `\n  ${80 + launches.length}     1   00:01 /bin/bash /p/pr-watch-loop.sh --slot ${slotDir} --repo ${pr.repo} --pr ${pr.number} --base ${baseBranch}`;
      writeFileSync(join(slotDir, "watch-listener"), "muggle-watch\n");
      writeFileSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE), `DRAIN pr=${pr.number} state=OPEN\nARMED pr=${pr.number}\n`);
      return true;
    },
    sleep: () => undefined,
  };
  return { paths: paths, machine: machine, runner: runner, notifications: notifications, launches: launches, deps: deps, projectCwd: projectCwd };
}

// The loop the watch started exits, leaving its last line in the slot.
function exitServiceLoop(machine: MachineState, slotDir: string, lastLine: string): void {
  machine.psOutput = machine.psOutput.split("\n").filter((line) => !line.includes(`--slot ${slotDir} `)).join("\n");
  writeFileSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE), `DRAIN pr=1 state=OPEN\n${lastLine}\n`);
}

function sessionCalls(runner: ReturnType<typeof buildMachine>["runner"]): string[][] {
  return runner.calls
    .filter((call) => call.executable === "claude" && ["stop", "--resume", "respawn"].includes(call.args[0]))
    .map((call) => call.args);
}

// What a Remote Control pass may do to a real session: respawn it. The trust probe's own stop is left out.
function respawnCallsOrResumes(runner: ReturnType<typeof buildMachine>["runner"]): string[][] {
  return sessionCalls(runner).filter((args) => args[0] === "respawn" || args[0] === "--resume" || (args[0] === "stop" && args[1] !== PROBE_ID));
}

function readEvents(watchDir: string): Array<{ kind: WatchEventKind; code?: WatchFindingCode; message?: string }> {
  return readFileSync(join(watchDir, "events.jsonl"), "utf-8").trim().split("\n").map((line) => JSON.parse(line));
}

function readState(watchDir: string) {
  return JSON.parse(readFileSync(join(watchDir, "state.json"), "utf-8"));
}

describe("runWatchTick", () => {
  it("records findings, coverage and builds, restarts a dead registered loop without touching any session, and notifies once", () => {
    const { deps, runner, notifications, paths, launches } = buildMachine();
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
    expect(launches).toEqual([["red-pr", "main"]]);
    expect(snapshot.serviceArms).toEqual([{ slug: "red-pr", prUrl: "https://github.com/o/r/pull/1", outcome: ServiceArmOutcome.Armed }]);
    expect(snapshot.recoveries).toEqual([]);
    expect(sessionCalls(runner)).toEqual([]);
    expect(runner.calls.some((call) => call.args[0] === "--bg")).toBe(false);

    expect(notifications).toHaveLength(1);
    expect(notifications[0].some((line) => /woke|resum/i.test(line))).toBe(false);
    expect(readEvents(paths.watchDir).map((event) => event.kind)).toEqual([
      WatchEventKind.Raised,
      WatchEventKind.Raised,
      WatchEventKind.Raised,
      WatchEventKind.Armed,
    ]);
    expect(loadLastWatchSnapshot(paths)?.takenAt).toBe(new Date(NOW_MS).toISOString());
    const state = readState(paths.watchDir);
    expect(Object.keys(state.activeFindings)).toHaveLength(3);
    expect(state.recoveryAttemptsByOwner).toEqual({});
  });

  it("counts a loop the watch started as heard even though its owner has ended, and stays quiet", () => {
    const { deps, notifications, launches } = buildMachine();
    runWatchTick(deps);
    const second = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });
    expect(second.slots.map((slot) => [slot.slug, slot.watcher])).toEqual([["red-pr", "polling"], ["watched", "polling"]]);
    expect(second.findings.map((current) => current.code)).not.toContain(WatchFindingCode.WatcherDead);
    expect(launches).toHaveLength(1);
    expect(notifications).toHaveLength(1);
  });

  it("wakes the owner with its own PR's report once the loop exits, and only once", () => {
    const { deps, machine, runner, notifications, paths, launches, projectCwd } = buildMachine();
    const slotDir = join(paths.slotsDir, "red-pr");
    runWatchTick(deps);
    exitServiceLoop(machine, slotDir, NEW_REVIEW_LINE);
    const second = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });

    expect(second.recoveries.map((recovery) => [recovery.ownerSessionId, recovery.slotSlug, recovery.outcome, recovery.cwd])).toEqual([
      ["owner-gone", "red-pr", WatcherRecoveryOutcome.Resumed, projectCwd],
    ]);
    expect(sessionCalls(runner)).toEqual([["--resume", "owner-gone", "--bg", "/muggle:muggle-pr-followup red-pr 1 --wake=event"]]);
    expect(existsSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE))).toBe(false);
    expect(readFileSync(join(slotDir, SERVICE_LOOP_DELIVERED_FILE), "utf-8")).toContain(NEW_REVIEW_LINE);
    expect(launches).toHaveLength(1);
    expect(notifications[notifications.length - 1]).toContain("Woke session owner-go for PR #1 (event)");

    machine.claudeListing = [...(machine.claudeListing ?? []), { id: "owner-go", sessionId: "owner-gone", kind: "background", status: "busy" }];
    const third = runWatchTick({ ...deps, nowMs: NOW_MS + 240_000 });
    expect(third.recoveries).toEqual([]);
    expect(third.serviceArms).toEqual([]);
    expect(sessionCalls(runner)).toHaveLength(1);
  });

  it("restarts a loop that expired quietly, without waking anyone", () => {
    const { deps, machine, runner, paths, launches } = buildMachine();
    runWatchTick(deps);
    exitServiceLoop(machine, join(paths.slotsDir, "red-pr"), "EXPIRED pr=1 watch lifetime of 604800s reached — re-arm to keep watching");
    const second = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });
    expect(second.recoveries).toEqual([]);
    expect(second.serviceArms?.map((serviceArm) => serviceArm.outcome)).toEqual([ServiceArmOutcome.Armed]);
    expect(launches).toHaveLength(2);
    expect(sessionCalls(runner)).toEqual([]);
  });

  it("holds a report for an owner mid-turn or waiting on its user, and tells the user once it is overdue", () => {
    const { deps, machine, runner, paths, notifications } = buildMachine();
    const slotDir = writeSlot(paths.slotsDir, "busy-owned", {
      prsJson: [openPrEntry("o/r", 2)],
      ownerSessionId: "owner-live",
      heartbeatMtimeMs: NOW_MS - 2 * HOUR_MS,
      isRegistered: true,
    });
    const reportPath = join(slotDir, SERVICE_LOOP_OUTPUT_FILE);
    writeFileSync(reportPath, `${NEW_REVIEW_LINE}\n`);
    utimesSync(reportPath, (NOW_MS - 60_000) / 1000, (NOW_MS - 60_000) / 1000);
    const first = runWatchTick(deps);
    expect(sessionCalls(runner)).toEqual([]);
    expect(first.findings.map((current) => current.code)).not.toContain(WatchFindingCode.OwnerWakePending);

    const overdue = runWatchTick({ ...deps, nowMs: NOW_MS + HOUR_MS });
    expect(overdue.findings.find((current) => current.code === WatchFindingCode.OwnerWakePending)?.message).toContain(
      "run /muggle:muggle-pr-followup busy-owned 2 --wake=event there",
    );
    expect(notifications.flat().some((line) => line.includes("waiting for owner session owner-li"))).toBe(true);
    machine.claudeListing = (machine.claudeListing ?? []).map((listing) =>
      (listing as { sessionId: string }).sessionId === "owner-live" ? { ...(listing as object), status: "waiting" } : listing,
    );
    runWatchTick({ ...deps, nowMs: NOW_MS + 2 * HOUR_MS });
    expect(sessionCalls(runner)).toEqual([]);
  });

  it("closes out a merged PR's slot that nobody watches, sending nothing to the PR", () => {
    const { deps, machine, paths, runner } = buildMachine();
    runWatchTick(deps);
    machine.prNodesByNumber[1] = { state: "MERGED" };
    exitServiceLoop(machine, join(paths.slotsDir, "red-pr"), "TERMINAL pr=1 state=MERGED");
    const second = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });

    expect(second.closedOutSlugs).toEqual(["red-pr"]);
    expect(sessionCalls(runner)).toEqual([]);
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

  it("leaves an idle session that owns open PR watches running through a reload, pushing nothing into it", () => {
    const { deps, runner, paths } = buildMachine();
    writeSlot(paths.slotsDir, "idle-owned", { prsJson: [openPrEntry("o/r", 2)], ownerSessionId: "idle-bg", heartbeatMtimeMs: NOW_MS - 30_000 });
    runWatchTick(deps);
    appendInstall(paths.muggleInstallLogFile, NOW_MS + 60_000, "2.0.0");
    const afterInstall = runWatchTick({ ...deps, nowMs: NOW_MS + 120_000 });

    expect(afterInstall.reload?.decisions.find((decision) => decision.sessionId === "idle-bg")).toMatchObject({
      action: ReloadAction.Skip,
      reason: "owns open PR watches — left running; run /reload-plugins in it",
    });
    expect(sessionCalls(runner)).toEqual([]);
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

  it("restarts an idle owner's dead loop without stopping, resuming or prompting the owner", () => {
    const { deps, runner, paths, launches } = buildMachine();
    writeSlot(paths.slotsDir, "idle-dead", {
      prsJson: [openPrEntry("o/r", 2)],
      ownerSessionId: "idle-bg",
      heartbeatMtimeMs: NOW_MS - 2 * HOUR_MS,
      isRegistered: true,
    });
    appendInstall(paths.muggleInstallLogFile, NOW_MS - 60_000, "2.0.0");
    const snapshot = runWatchTick(deps);

    expect(launches.map(([slug]) => slug)).toContain("idle-dead");
    expect(snapshot.recoveries).toEqual([]);
    expect(sessionCalls(runner).filter((args) => args.includes("idle-bg") || args.includes("idle-bg1"))).toEqual([]);
    expect(snapshot.reload?.decisions.find((decision) => decision.sessionId === "idle-bg")?.action).toBe(ReloadAction.Skip);
  });

  it("stops an idle owner and resumes it on its own PR's report, leaving it out of the same tick's reload", () => {
    const { deps, runner, paths, projectCwd } = buildMachine();
    writeFileSync(join(paths.claudeProjectsDir, "repo", "idle-bg.jsonl"), `${JSON.stringify({ cwd: projectCwd })}\n`);
    const slotDir = writeSlot(paths.slotsDir, "idle-dead", {
      prsJson: [openPrEntry("o/r", 2)],
      ownerSessionId: "idle-bg",
      heartbeatMtimeMs: NOW_MS - 2 * HOUR_MS,
      isRegistered: true,
    });
    writeFileSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE), "EVENT pr=2 checks settled red head=head2\n");
    appendInstall(paths.muggleInstallLogFile, NOW_MS - 60_000, "2.0.0");
    const snapshot = runWatchTick(deps);

    expect(snapshot.recoveries.find((recovery) => recovery.ownerSessionId === "idle-bg")).toMatchObject({
      slotSlug: "idle-dead",
      outcome: WatcherRecoveryOutcome.Resumed,
      ownerShortId: "idle-bg1",
    });
    expect(sessionCalls(runner).filter((args) => args.includes("idle-bg") || args.includes("idle-bg1"))).toEqual([
      ["stop", "idle-bg1"],
      ["--resume", "idle-bg", "--bg", "/muggle:muggle-pr-followup idle-dead 2 --wake=event"],
    ]);
    expect(snapshot.reload?.decisions.map((decision) => decision.sessionId)).not.toContain("idle-bg");
  });

  it("gives up on an owner that outlives its stop instead of starting a copy of it", () => {
    const { deps, runner, paths, machine, projectCwd } = buildMachine();
    writeFileSync(join(paths.claudeProjectsDir, "repo", "idle-bg.jsonl"), `${JSON.stringify({ cwd: projectCwd })}\n`);
    const slotDir = writeSlot(paths.slotsDir, "idle-dead", { prsJson: [openPrEntry("o/r", 2)], ownerSessionId: "idle-bg", heartbeatMtimeMs: NOW_MS - 2 * HOUR_MS, isRegistered: true });
    writeFileSync(join(slotDir, SERVICE_LOOP_OUTPUT_FILE), "EVENT pr=2 checks settled red head=head2\n");
    machine.unstoppableShortIds.add("idle-bg1");
    const naps: number[] = [];
    const snapshot = runWatchTick({ ...deps, sleep: (durationMs) => naps.push(durationMs) });

    expect(snapshot.recoveries.find((recovery) => recovery.ownerSessionId === "idle-bg")?.outcome).toBe(WatcherRecoveryOutcome.ResumeFailed);
    expect(runner.calls.some((call) => call.args[0] === "--resume" && call.args[1] === "idle-bg")).toBe(false);
    expect(naps.reduce((total, durationMs) => total + durationMs, 0)).toBe(SESSION_EXIT_WAIT_MS);
  });

  it("resumes an owner that is still listed but has no process behind it, without a stop", () => {
    const { deps, runner, machine, paths } = buildMachine();
    machine.claudeListing = [...(machine.claudeListing ?? []), { id: "owner-go", sessionId: "owner-gone", kind: "background", state: "blocked" }];
    writeFileSync(join(paths.slotsDir, "red-pr", SERVICE_LOOP_OUTPUT_FILE), `${NEW_REVIEW_LINE}\n`);
    const snapshot = runWatchTick(deps);

    expect(snapshot.slots.find((slot) => slot.slug === "red-pr")?.isOwnerSessionActive).toBe(false);
    expect(snapshot.recoveries.map((recovery) => [recovery.ownerSessionId, recovery.outcome, recovery.ownerShortId])).toEqual([
      ["owner-gone", WatcherRecoveryOutcome.Resumed, undefined],
    ]);
    expect(runner.calls.some((call) => call.args[0] === "stop")).toBe(false);
  });

  it("leaves a watch owner running through a reload even when its PR's status could not be fetched", () => {
    const { deps, runner, paths } = buildMachine();
    writeSlot(paths.slotsDir, "idle-owned", { prsJson: [openPrEntry("o/r", 3)], ownerSessionId: "idle-bg", heartbeatMtimeMs: NOW_MS - 30_000 });
    appendInstall(paths.muggleInstallLogFile, NOW_MS - 60_000, "2.0.0");
    const snapshot = runWatchTick(deps);

    expect(snapshot.slots.find((slot) => slot.slug === "idle-owned")?.live).toBeUndefined();
    expect(snapshot.reload?.decisions.find((decision) => decision.sessionId === "idle-bg")?.action).toBe(ReloadAction.Skip);
    expect(sessionCalls(runner)).toEqual([]);
  });

  it("reports without restarting loops or waking anyone when recovery is off", () => {
    const { deps, runner, launches } = buildMachine();
    const snapshot = runWatchTick({ ...deps, isRecoveryEnabled: false });
    expect(snapshot.recoveries).toEqual([]);
    expect(snapshot.serviceArms).toEqual([]);
    expect(launches).toEqual([]);
    expect(runner.calls.some((call) => call.args[0] === "--resume")).toBe(false);
  });

  it("holds owner wakes while Claude's cached usage shows a limit that has not reset", () => {
    const { deps, runner, paths } = buildMachine();
    writeFileSync(join(paths.slotsDir, "red-pr", SERVICE_LOOP_OUTPUT_FILE), `${NEW_REVIEW_LINE}\n`);
    const resetsAt = new Date(NOW_MS + HOUR_MS).toISOString();
    writeFileSync(
      paths.claudeGlobalConfigFile,
      JSON.stringify({ cachedUsageUtilization: { utilization: { seven_day: { utilization: 100, resets_at: resetsAt, locked_reason: null } } } }),
    );
    const snapshot = runWatchTick(deps);

    expect(snapshot.recoveries.length).toBeGreaterThan(0);
    expect(snapshot.recoveries.every((recovery) => recovery.outcome === WatcherRecoveryOutcome.AwaitingUsageLimitReset)).toBe(true);
    expect(runner.calls.some((call) => call.args[0] === "--resume" || call.args[0] === "stop")).toBe(false);
  });

  it("judges by heartbeat alone when the process table cannot be read", () => {
    const { deps } = buildMachine();
    const snapshot = runWatchTick({ ...deps, runCommand: (executable, args, options) => (executable === "ps" ? null : deps.runCommand(executable, args, options)) });
    expect(snapshot.processes).toEqual([]);
    expect(snapshot.sessions.every((session) => session.loadedAtMs === undefined)).toBe(true);
    expect(snapshot.slots.map((slot) => slot.watcher)).toEqual(["dead", "polling"]);
  });
});

describe("runWatchTick Remote Control", () => {
  it("restarts sessions off Remote Control in place once their turn is over, watch owners included", () => {
    const { deps, runner, paths, launches } = buildMachine();
    logInWithRemoteControl(paths, "account-a");
    writeRegistry(paths.claudeSessionRegistryDir, 70, "owner-live", { status: "shell" });
    writeRegistry(paths.claudeSessionRegistryDir, 71, "idle-bg", { status: "idle", bridgeSessionId: null });
    const snapshot = runWatchTick(deps);

    expect(snapshot.remoteControl?.respawnedSessionIds).toEqual(["owner-live", "idle-bg"]);
    expect(respawnCallsOrResumes(runner)).toEqual([["respawn", "owner-li"], ["respawn", "idle-bg1"]]);
    expect(snapshot.remoteControl?.decisions.find((decision) => decision.sessionId === "terminal-1")?.action).toBe(ReloadAction.NotifyManual);
    expect(launches.map(([slug]) => slug)).not.toContain("watched");
    expect(readEvents(paths.watchDir).filter((event) => event.kind === WatchEventKind.Respawned).map((event) => event.message)).toEqual([
      "restarted to reconnect Remote Control: no Remote Control link",
      "restarted to reconnect Remote Control: no Remote Control link",
    ]);
    const state = readState(paths.watchDir);
    expect(Object.keys(state.remoteControlRestartsBySession)).toEqual(["owner-live", "idle-bg"]);
    expect(state.claudeLogin).toEqual({ accountUuid: "account-a", observedAtMs: NOW_MS });
  });

  it("leaves linked sessions alone until the login changes, then relinks them under the new one", () => {
    const { deps, runner, paths } = buildMachine();
    logInWithRemoteControl(paths, "account-a");
    writeRegistry(paths.claudeSessionRegistryDir, 70, "owner-live", { status: "shell", bridgeSessionId: "session_owner" });
    writeRegistry(paths.claudeSessionRegistryDir, 71, "idle-bg", { status: "idle", bridgeSessionId: "session_idle" });
    const first = runWatchTick(deps);
    expect(first.remoteControl?.connectedSessionIds).toEqual(["owner-live", "idle-bg"]);
    expect(respawnCallsOrResumes(runner)).toEqual([]);

    logInWithRemoteControl(paths, "account-b", NOW_MS + 30_000);
    const second = runWatchTick({ ...deps, nowMs: NOW_MS + 60_000 });
    expect(second.remoteControl?.decisions.filter((decision) => decision.action === ReloadAction.Respawn).map((decision) => decision.reason)).toEqual([
      "linked under an earlier login",
      "linked under an earlier login",
    ]);
    expect(respawnCallsOrResumes(runner)).toEqual([["respawn", "owner-li"], ["respawn", "idle-bg1"]]);
    expect(readState(paths.watchDir).claudeLogin).toEqual({ accountUuid: "account-b", effectiveAtMs: NOW_MS + 30_000, observedAtMs: NOW_MS + 60_000 });
  });

  it("leaves a session the reload just restarted to the reload, and shares its restart cap", () => {
    const { deps, runner, paths } = buildMachine();
    logInWithRemoteControl(paths, "account-a");
    writeRegistry(paths.claudeSessionRegistryDir, 70, "owner-live", { status: "shell" });
    writeRegistry(paths.claudeSessionRegistryDir, 71, "idle-bg", { status: "idle" });
    appendInstall(paths.muggleInstallLogFile, NOW_MS - 60_000, "2.0.0");
    const snapshot = runWatchTick(deps);

    expect(snapshot.reload?.respawnedSessionIds).toEqual(["idle-bg"]);
    expect(snapshot.remoteControl?.respawnedSessionIds).toEqual(["owner-live"]);
    expect(snapshot.remoteControl?.decisions.some((decision) => decision.sessionId === "idle-bg")).toBe(false);
    expect(respawnCallsOrResumes(runner).filter((args) => args[0] === "respawn")).toHaveLength(2);
  });

  it("waits for a turn in flight and leaves a workspace that refuses restarts", () => {
    const { deps, runner, paths, machine, projectCwd } = buildMachine();
    logInWithRemoteControl(paths, "account-a");
    writeRegistry(paths.claudeSessionRegistryDir, 70, "owner-live", { status: "busy" });
    writeRegistry(paths.claudeSessionRegistryDir, 71, "idle-bg", { status: "idle" });
    machine.untrustedCwds.add(projectCwd);
    const snapshot = runWatchTick(deps);

    expect(snapshot.remoteControl?.decisions.find((decision) => decision.sessionId === "owner-live")?.action).toBe(ReloadAction.Defer);
    expect(snapshot.remoteControl?.untrustedSessionIds).toEqual(["idle-bg"]);
    expect(respawnCallsOrResumes(runner)).toEqual([]);
    expect(readEvents(paths.watchDir).some((event) => event.kind === WatchEventKind.RestartRefused)).toBe(true);
  });

  it("takes over a watch loop its restarted owner did not adopt, without touching the session", () => {
    const { deps, runner, paths, machine, launches } = buildMachine();
    (machine.claudeListing as Array<{ id: string; status?: string }>)[0].status = "idle";
    writeRegistry(paths.claudeSessionRegistryDir, 70, "owner-live", { status: "idle", statusUpdatedAt: NOW_MS - 30_000 });
    const snapshot = runWatchTick(deps);

    expect(snapshot.slots.find((slot) => slot.slug === "watched")).toMatchObject({ watcher: "deaf", isLoopDroppedByOwner: true });
    expect(launches).toContainEqual(["watched", "main"]);
    expect(snapshot.findings.find((current) => current.code === WatchFindingCode.WatcherDeaf)?.message).toContain("is running but no longer holds it");
    expect(respawnCallsOrResumes(runner)).toEqual([]);
  });

  it("runs no pass without Remote Control at startup, a claude.ai login, or with the pass switched off", () => {
    const off = buildMachine();
    expect(runWatchTick(off.deps).remoteControl).toBeUndefined();

    const switchedOff = buildMachine();
    logInWithRemoteControl(switchedOff.paths, "account-a");
    expect(runWatchTick({ ...switchedOff.deps, isRemoteControlKeptOn: false }).remoteControl).toBeUndefined();

    const noLogin = buildMachine();
    logInWithRemoteControl(noLogin.paths, "account-a");
    writeFileSync(noLogin.paths.claudeGlobalConfigFile, JSON.stringify({}));
    expect(runWatchTick(noLogin.deps).remoteControl).toBeUndefined();

    for (const machine of [off, switchedOff, noLogin]) expect(respawnCallsOrResumes(machine.runner)).toEqual([]);
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

  it("leaves the last snapshot's watch owners running", () => {
    const { deps, runner, paths } = buildMachine();
    writeSlot(paths.slotsDir, "idle-owned", { prsJson: [openPrEntry("o/r", 2)], ownerSessionId: "idle-bg", heartbeatMtimeMs: NOW_MS - 30_000 });
    runWatchTick({ ...deps, isAutoReloadEnabled: false });
    const report = runReloadPluginsPass({ ...deps, nowMs: NOW_MS + 60_000 }, false);
    expect(report?.decisions.find((decision) => decision.sessionId === "idle-bg")?.action).toBe(ReloadAction.Skip);
    expect(sessionCalls(runner)).toEqual([]);
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
    const deps = createDefaultWatchTickDeps({ isAutoReloadEnabled: false, isRecoveryEnabled: true, isRemoteControlKeptOn: false });
    expect(deps.platform).toBe(process.platform);
    expect(deps.isAutoReloadEnabled).toBe(false);
    expect(deps.isRecoveryEnabled).toBe(true);
    expect(deps.isRemoteControlKeptOn).toBe(false);
    expect(deps.paths.watchDir).toMatch(/[\\/]\.muggle-ai[\\/]watch$/);
    expect(deps.paths.muggleInstallLogFile).toMatch(/[\\/]\.muggle-ai[\\/]postinstall\.log$/);
  });
});
