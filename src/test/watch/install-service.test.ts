import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { PreferenceValue } from "../../../packages/mcps/src/shared/preferences-types.js";
import { WATCH_CRON_MARKER } from "../../watch/constants.js";
import {
  applyWatchServicePreference,
  createDefaultWatchServiceInstallDeps,
  findInstalledScheduler,
  installWatchService,
  uninstallWatchService,
} from "../../watch/install-service.js";
import {
  renderCronLine,
  renderLaunchdPlist,
  renderSystemdService,
  renderSystemdTimer,
  renderWatchEnvFile,
  shellQuote,
} from "../../watch/schedule-files.js";
import { resolveScheduledMuggleEntry } from "../../watch/service-installer.js";
import {
  WatchSchedulerKind,
  WatchServiceInstallOutcome,
  type CommandOptions,
  type CommandOutcome,
  type PosixTickJob,
  type WatchServiceInstallDeps,
} from "../../watch/types.js";
import { makeTempDir, scriptedRunner, succeeded } from "./fixtures.js";

const job: PosixTickJob = {
  launcherPath: "/home/u/.muggle-ai/watch/bin/muggle-watch-tick.sh",
  nodePath: "/usr/local/bin/node",
  muggleEntry: "/opt/npm & co/lib/node_modules/@muggleai/works/bin/muggle.js",
  intervalSeconds: 120,
};

describe("schedule files", () => {
  it("renders a launchd agent that runs the launcher every interval, escaped for XML", () => {
    const plist = renderLaunchdPlist(job);
    expect(plist).toContain("<string>ai.muggle.watch</string>");
    expect(plist).toContain("<string>/bin/sh</string>\n    <string>/home/u/.muggle-ai/watch/bin/muggle-watch-tick.sh</string>");
    expect(plist).toContain("<string>/opt/npm &amp; co/lib/node_modules/@muggleai/works/bin/muggle.js</string>");
    expect(plist).toContain("<key>StartInterval</key>\n  <integer>120</integer>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <false/>");
  });

  it("renders a oneshot systemd service with quoted arguments and doubled specifiers", () => {
    const service = renderSystemdService({ ...job, muggleEntry: '/srv/100%/m "q".js' });
    expect(service).toContain("Type=oneshot");
    expect(service).toContain('ExecStart="/bin/sh" "/home/u/.muggle-ai/watch/bin/muggle-watch-tick.sh" "/usr/local/bin/node" "/srv/100%%/m \\"q\\".js"');
    const timer = renderSystemdTimer(job);
    expect(timer).toContain("OnActiveSec=2min\nOnUnitActiveSec=2min\nUnit=muggle-watch.service");
    expect(timer).toContain("WantedBy=timers.target");
  });

  it("renders a marked crontab line with shell quoting and cron's percent escaped", () => {
    expect(renderCronLine({ ...job, muggleEntry: "/m/50%/muggle.js" })).toBe(
      `*/2 * * * * '/bin/sh' '/home/u/.muggle-ai/watch/bin/muggle-watch-tick.sh' '/usr/local/bin/node' '/m/50\\%/muggle.js' ${WATCH_CRON_MARKER}`,
    );
  });

  it("quotes the recorded PATH so the launcher can source it", () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(renderWatchEnvFile("/usr/bin:/opt/it's/bin")).toContain("export PATH='/usr/bin:/opt/it'\\''s/bin'");
  });
});

interface FakeMachine {
  crontab: string[] | null;
  hasSystemdUser: boolean;
  launchctlBootstrapExit: number;
  globalRoot: string;
}

// The scheduler commands a POSIX install calls, answered from mutable machine state.
function posixAnswer(machine: FakeMachine): (executable: string, args: string[], options?: CommandOptions) => CommandOutcome | null {
  return (executable, args) => {
    if (executable === "npm") return succeeded(`${machine.globalRoot}\n`);
    if (executable === "launchctl") {
      if (args[0] === "bootstrap") return { exitCode: machine.launchctlBootstrapExit, stdout: machine.launchctlBootstrapExit === 0 ? "" : "Bootstrap failed: 5: Input/output error" };
      return succeeded("");
    }
    if (executable === "systemctl") return machine.hasSystemdUser ? succeeded("") : { exitCode: 1, stdout: "Failed to connect to bus" };
    if (executable === "crontab") {
      if (machine.crontab === null) return null;
      if (args[0] === "-l") return machine.crontab.length > 0 ? succeeded(`${machine.crontab.join("\n")}\n`) : { exitCode: 1, stdout: "" };
      machine.crontab = readFileSync(args[0], "utf-8").split("\n").filter((line) => line !== "");
      return succeeded("");
    }
    if (executable === "/usr/bin/node") return succeeded("muggle watch: 3 sessions, 1 PR watches, 0 findings (0 alerts), 0 owner sessions resumed\n");
    return null;
  };
}

function buildPosix(platform: NodeJS.Platform, overrides: Partial<FakeMachine> = {}) {
  const root = makeTempDir("watch-install");
  const globalRoot = join(root, "npm-global");
  mkdirSync(join(globalRoot, "@muggleai", "works", "bin"), { recursive: true });
  writeFileSync(join(globalRoot, "@muggleai", "works", "bin", "muggle.js"), "");
  const machine: FakeMachine = { crontab: [], hasSystemdUser: true, launchctlBootstrapExit: 0, globalRoot: globalRoot, ...overrides };
  const runner = scriptedRunner(posixAnswer(machine));
  const homeDir = join(root, "home");
  const deps: WatchServiceInstallDeps = {
    platform: platform,
    runCommand: runner.runCommand,
    homeDir: homeDir,
    watchDir: join(homeDir, ".muggle-ai", "watch"),
    env: { PATH: "/usr/local/bin:/usr/bin" },
    nodePath: "/usr/bin/node",
    uid: 501,
  };
  return { machine: machine, runner: runner, deps: deps, homeDir: homeDir, globalEntry: join(globalRoot, "@muggleai", "works", "bin", "muggle.js") };
}

const callsOf = (runner: ReturnType<typeof scriptedRunner>, executable: string) =>
  runner.calls.filter((call) => call.executable === executable).map((call) => call.args.join(" "));

describe("installing on macOS", () => {
  it("stages the launcher with the PATH, writes the launchd agent, and replaces any loaded copy", () => {
    const { deps, runner, homeDir, globalEntry } = buildPosix("darwin");
    const report = installWatchService(deps, true);

    expect(report).toEqual({ outcome: WatchServiceInstallOutcome.Installed, detail: "launchd agent ai.muggle.watch loaded, every 2 min" });
    const binDir = join(deps.watchDir, "bin");
    expect(readFileSync(join(binDir, "muggle-watch-tick.sh"), "utf-8")).toContain("watch tick");
    expect(readFileSync(join(binDir, "watch-env.sh"), "utf-8")).toContain("export PATH='/usr/local/bin:/usr/bin'");
    const plist = readFileSync(join(homeDir, "Library", "LaunchAgents", "ai.muggle.watch.plist"), "utf-8");
    expect(plist).toContain(`<string>${globalEntry}</string>`);
    expect(callsOf(runner, "launchctl")).toEqual([
      "bootout gui/501/ai.muggle.watch",
      `bootstrap gui/501 ${join(homeDir, "Library", "LaunchAgents", "ai.muggle.watch.plist")}`,
    ]);
    expect(findInstalledScheduler(deps)).toBe(WatchSchedulerKind.Launchd);
  });

  it("runs a first tick itself unless told not to wait, and reports a refused bootstrap", () => {
    const { deps, runner } = buildPosix("darwin");
    expect(installWatchService(deps, false).detail).toBe(
      "launchd agent ai.muggle.watch loaded, every 2 min; first tick: muggle watch: 3 sessions, 1 PR watches, 0 findings (0 alerts), 0 owner sessions resumed",
    );
    expect(runner.calls.find((call) => call.executable === "/usr/bin/node")?.args.slice(1)).toEqual(["watch", "tick"]);

    const { deps: refusedDeps } = buildPosix("darwin", { launchctlBootstrapExit: 5 });
    expect(installWatchService(refusedDeps, true)).toEqual({
      outcome: WatchServiceInstallOutcome.Failed,
      detail: "launchctl bootstrap failed: Bootstrap failed: 5: Input/output error",
    });
  });

  it("refreshes an installed agent on ask, and uninstalls it", () => {
    const { deps, homeDir } = buildPosix("darwin");
    expect(applyWatchServicePreference(PreferenceValue.Ask, deps, true).outcome).toBe(WatchServiceInstallOutcome.NotRequested);
    installWatchService(deps, true);
    expect(applyWatchServicePreference(PreferenceValue.Ask, deps, true).outcome).toBe(WatchServiceInstallOutcome.Refreshed);
    expect(uninstallWatchService(deps).outcome).toBe(WatchServiceInstallOutcome.Removed);
    expect(existsSync(join(homeDir, "Library", "LaunchAgents", "ai.muggle.watch.plist"))).toBe(false);
    expect(findInstalledScheduler(deps)).toBeUndefined();
  });
});

describe("installing on Linux", () => {
  it("prefers a systemd user timer, and drops a cron line an earlier install left", () => {
    const { deps, runner, machine, homeDir } = buildPosix("linux", { crontab: ["0 * * * * backup", `*/2 * * * * old ${WATCH_CRON_MARKER}`] });
    const report = installWatchService(deps, true);

    expect(report).toEqual({ outcome: WatchServiceInstallOutcome.Installed, detail: "systemd user timer muggle-watch.timer enabled, every 2 min" });
    const unitDir = join(homeDir, ".config", "systemd", "user");
    expect(readFileSync(join(unitDir, "muggle-watch.service"), "utf-8")).toContain("Type=oneshot");
    expect(readFileSync(join(unitDir, "muggle-watch.timer"), "utf-8")).toContain("OnUnitActiveSec=2min");
    expect(callsOf(runner, "systemctl")).toEqual(["--user show-environment", "--user daemon-reload", "--user enable --now muggle-watch.timer"]);
    expect(machine.crontab).toEqual(["0 * * * * backup"]);
    expect(findInstalledScheduler(deps)).toBe(WatchSchedulerKind.SystemdUser);

    expect(uninstallWatchService(deps).outcome).toBe(WatchServiceInstallOutcome.Removed);
    expect(existsSync(join(unitDir, "muggle-watch.timer"))).toBe(false);
    expect(callsOf(runner, "systemctl")).toContain("--user disable --now muggle-watch.timer");
  });

  it("honours XDG_CONFIG_HOME for the units", () => {
    const { deps } = buildPosix("linux");
    const configHome = makeTempDir("xdg");
    installWatchService({ ...deps, env: { ...deps.env, XDG_CONFIG_HOME: configHome } }, true);
    expect(existsSync(join(configHome, "systemd", "user", "muggle-watch.timer"))).toBe(true);
  });

  it("falls back to one marked crontab line, replaced in place and removed on uninstall", () => {
    const { deps, machine } = buildPosix("linux", { hasSystemdUser: false, crontab: ["0 * * * * backup"] });
    expect(installWatchService(deps, true)).toEqual({ outcome: WatchServiceInstallOutcome.Installed, detail: "crontab line added, every 2 min" });
    installWatchService(deps, true);
    expect(machine.crontab?.filter((line) => line.endsWith(WATCH_CRON_MARKER))).toHaveLength(1);
    expect(machine.crontab?.[0]).toBe("0 * * * * backup");
    expect(existsSync(join(deps.watchDir, "bin", "crontab.txt"))).toBe(false);
    expect(findInstalledScheduler(deps)).toBe(WatchSchedulerKind.Cron);
    expect(applyWatchServicePreference(PreferenceValue.Ask, deps, true).outcome).toBe(WatchServiceInstallOutcome.Refreshed);

    expect(uninstallWatchService(deps)).toEqual({ outcome: WatchServiceInstallOutcome.Removed, detail: "crontab line removed" });
    expect(machine.crontab).toEqual(["0 * * * * backup"]);
  });

  it("is unsupported only with neither systemd nor crontab", () => {
    const { deps } = buildPosix("linux", { hasSystemdUser: false, crontab: null });
    expect(installWatchService(deps, true)).toEqual({
      outcome: WatchServiceInstallOutcome.Unsupported,
      detail: "no launchd, systemd user session or crontab on linux",
    });
    expect(uninstallWatchService(deps).outcome).toBe(WatchServiceInstallOutcome.Removed);
  });
});

describe("installing on Windows", () => {
  function windowsDeps(isRegistered: boolean, installerExitCode = 0) {
    const runner = scriptedRunner((executable) => {
      if (executable === "schtasks.exe") return { exitCode: isRegistered ? 0 : 1, stdout: "" };
      if (executable === "powershell.exe") return { exitCode: installerExitCode, stdout: installerExitCode === 0 ? "task MuggleWatch registered\n" : "access denied\n" };
      return null;
    });
    const deps: WatchServiceInstallDeps = { ...buildPosix("win32").deps, runCommand: runner.runCommand };
    return { deps: deps, runner: runner };
  }

  it("acts on each preference value, refreshing a registered task for anything but never", () => {
    const outcomeOf = (preference: PreferenceValue, isRegistered: boolean) => applyWatchServicePreference(preference, windowsDeps(isRegistered).deps, true).outcome;
    expect(outcomeOf(PreferenceValue.Never, true)).toBe(WatchServiceInstallOutcome.TurnedOff);
    expect(outcomeOf(PreferenceValue.Ask, false)).toBe(WatchServiceInstallOutcome.NotRequested);
    expect(outcomeOf(PreferenceValue.Ask, true)).toBe(WatchServiceInstallOutcome.Refreshed);
    expect(outcomeOf(PreferenceValue.Always, true)).toBe(WatchServiceInstallOutcome.Refreshed);
    expect(outcomeOf(PreferenceValue.Always, false)).toBe(WatchServiceInstallOutcome.Installed);
  });

  it("runs the shipped installer, without waiting on request, and uninstalls through it", () => {
    const { deps, runner } = windowsDeps(false);
    expect(installWatchService(deps, true).detail).toBe("task MuggleWatch registered");
    expect(uninstallWatchService(deps).outcome).toBe(WatchServiceInstallOutcome.Removed);
    const installerCalls = runner.calls.filter((call) => call.executable === "powershell.exe");
    expect(installerCalls[0].args.slice(-3)).toEqual(["-File", expect.stringMatching(/install-muggle-watch\.ps1$/), "-NoWait"]);
    expect(installerCalls[0].options?.timeoutMs).toBeGreaterThan(120_000);
    expect(installerCalls[1].args[installerCalls[1].args.length - 1]).toBe("-Uninstall");
    expect(installWatchService(windowsDeps(false, 1).deps, true)).toEqual({ outcome: WatchServiceInstallOutcome.Failed, detail: "access denied" });
  });
});

describe("resolveScheduledMuggleEntry", () => {
  it("prefers the global install, and falls back to this package's own entry", () => {
    const { globalEntry, runner } = buildPosix("linux");
    expect(resolveScheduledMuggleEntry(runner.runCommand)).toBe(globalEntry);
    expect(resolveScheduledMuggleEntry(scriptedRunner(() => null).runCommand)).toMatch(/bin[\\/]muggle\.js$/);
  });
});

describe("createDefaultWatchServiceInstallDeps", () => {
  it("wires this platform, user and node", () => {
    const deps = createDefaultWatchServiceInstallDeps();
    expect(deps.platform).toBe(process.platform);
    expect(deps.nodePath).toBe(process.execPath);
    expect(deps.watchDir).toMatch(/[\\/]\.muggle-ai[\\/]watch$/);
  });
});
