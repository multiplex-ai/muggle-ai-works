import { homedir } from "os";
import { join } from "path";
import { PreferenceValue } from "../../packages/mcps/src/shared/preferences-types.js";
import { defaultCommandRunner } from "./command-runner.js";
import {
  WATCH_BIN_DIR_NAME,
  WATCH_INSTALLER_RELATIVE_PATH,
  WATCH_INSTALLER_TIMEOUT_MS,
  WATCH_TICK_INTERVAL_SECONDS,
  WATCH_TICK_LAUNCHER_RELATIVE_PATH,
} from "./constants.js";
import { resolveWatchPaths } from "./paths.js";
import {
  installCronLine,
  installLaunchdAgent,
  installSystemdTimer,
  isCronLineInstalled,
  isCrontabAvailable,
  isLaunchdAgentInstalled,
  isSystemdTimerInstalled,
  isSystemdUserAvailable,
  removeCronLine,
  removeLaunchdAgent,
  removeSystemdTimer,
  resolvePosixSchedulePaths,
  stageTickLauncher,
} from "./posix-scheduler.js";
import { findShippedFile, isWatchTaskRegistered, resolveScheduledMuggleEntry, runWatchInstaller } from "./service-installer.js";
import {
  WatchSchedulerKind,
  WatchServiceInstallOutcome,
  type PosixSchedulePaths,
  type PosixTickJob,
  type SchedulerOutcome,
  type WatchServiceInstallDeps,
  type WatchServiceInstallReport,
} from "./types.js";

/** The real edges a watch-service install needs: this platform, user, PATH and scheduler commands. */
export function createDefaultWatchServiceInstallDeps(): WatchServiceInstallDeps {
  return {
    platform: process.platform,
    runCommand: defaultCommandRunner,
    homeDir: homedir(),
    watchDir: resolveWatchPaths().watchDir,
    env: process.env,
    nodePath: process.execPath,
    uid: process.getuid?.(),
  };
}

function schedulePathsOf(deps: WatchServiceInstallDeps): PosixSchedulePaths {
  return resolvePosixSchedulePaths(deps.homeDir, deps.env, join(deps.watchDir, WATCH_BIN_DIR_NAME));
}

/** The scheduler that runs the watch on this machine now, or undefined when none does. */
export function findInstalledScheduler(deps: WatchServiceInstallDeps): WatchSchedulerKind | undefined {
  if (deps.platform === "win32") return isWatchTaskRegistered(deps.runCommand) ? WatchSchedulerKind.TaskScheduler : undefined;
  const paths = schedulePathsOf(deps);
  if (deps.platform === "darwin") return isLaunchdAgentInstalled(paths) ? WatchSchedulerKind.Launchd : undefined;
  if (isSystemdTimerInstalled(paths)) return WatchSchedulerKind.SystemdUser;
  return isCronLineInstalled(deps.runCommand) ? WatchSchedulerKind.Cron : undefined;
}

function reportOf(outcome: SchedulerOutcome, succeededAs: WatchServiceInstallOutcome): WatchServiceInstallReport {
  return { outcome: outcome.isDone ? succeededAs : WatchServiceInstallOutcome.Failed, detail: outcome.detail };
}

function runWindowsInstaller(deps: WatchServiceInstallDeps, installerArgs: string[], succeededAs: WatchServiceInstallOutcome): WatchServiceInstallReport {
  const scriptPath = findShippedFile(WATCH_INSTALLER_RELATIVE_PATH);
  if (!scriptPath) return { outcome: WatchServiceInstallOutcome.Failed, detail: "the installer script is missing from this install" };
  const ran = runWatchInstaller(scriptPath, installerArgs, deps.runCommand);
  if (ran?.exitCode !== 0) {
    return { outcome: WatchServiceInstallOutcome.Failed, detail: ran ? ran.stdout.trim() || `installer exited ${ran.exitCode}` : "installer did not finish" };
  }
  return { outcome: succeededAs, detail: ran.stdout.trim() };
}

function prepareTickJob(deps: WatchServiceInstallDeps): PosixTickJob | string {
  const launcherSource = findShippedFile(WATCH_TICK_LAUNCHER_RELATIVE_PATH);
  if (!launcherSource) return "the tick launcher is missing from this install";
  const muggleEntry = resolveScheduledMuggleEntry(deps.runCommand);
  if (!muggleEntry) return "no muggle entry point found: install @muggleai/works globally";
  const launcherPath = stageTickLauncher(launcherSource, join(deps.watchDir, WATCH_BIN_DIR_NAME), deps.env.PATH ?? "");
  return { launcherPath: launcherPath, nodePath: deps.nodePath, muggleEntry: muggleEntry, intervalSeconds: WATCH_TICK_INTERVAL_SECONDS };
}

// macOS has launchd; on other POSIX systems a systemd user session is preferred
// and cron is the fallback where there is none, such as a container or a BSD.
function scheduleOnPosix(job: PosixTickJob, deps: WatchServiceInstallDeps): SchedulerOutcome | undefined {
  const paths = schedulePathsOf(deps);
  if (deps.platform === "darwin") return installLaunchdAgent(job, paths, deps.uid ?? 0, deps.runCommand);
  if (isSystemdUserAvailable(deps.runCommand)) {
    const scheduled = installSystemdTimer(job, paths, deps.runCommand);
    // A machine that gained a systemd session since a cron install must not tick twice.
    if (scheduled.isDone) removeCronLine(paths, deps.runCommand);
    return scheduled;
  }
  return isCrontabAvailable(deps.runCommand) ? installCronLine(job, paths, deps.runCommand) : undefined;
}

function installOnPosix(deps: WatchServiceInstallDeps, isNoWait: boolean, succeededAs: WatchServiceInstallOutcome): WatchServiceInstallReport {
  const job = prepareTickJob(deps);
  if (typeof job === "string") return { outcome: WatchServiceInstallOutcome.Failed, detail: job };
  const scheduled = scheduleOnPosix(job, deps);
  if (!scheduled) {
    return { outcome: WatchServiceInstallOutcome.Unsupported, detail: `no launchd, systemd user session or crontab on ${deps.platform}` };
  }
  if (!scheduled.isDone || isNoWait) return reportOf(scheduled, succeededAs);
  // The first scheduled run is a full interval away; running one now gives `muggle watch status` a snapshot at once.
  const firstTick = deps.runCommand(deps.nodePath, [job.muggleEntry, "watch", "tick"], { timeoutMs: WATCH_INSTALLER_TIMEOUT_MS, isStderrCaptured: true });
  const firstTickLine = firstTick?.stdout.trim().split("\n").pop() || "did not finish";
  return { outcome: succeededAs, detail: `${scheduled.detail}; first tick: ${firstTickLine}` };
}

function installOn(deps: WatchServiceInstallDeps, isNoWait: boolean, succeededAs: WatchServiceInstallOutcome): WatchServiceInstallReport {
  return deps.platform === "win32"
    ? runWindowsInstaller(deps, isNoWait ? ["-NoWait"] : [], succeededAs)
    : installOnPosix(deps, isNoWait, succeededAs);
}

/**
 * Schedule the watch with this platform's scheduler — Task Scheduler, launchd,
 * a systemd user timer or cron — or replace the entry in place when it exists.
 *
 * @param isNoWait - Return once the entry is registered, without waiting for a first tick.
 */
export function installWatchService(deps: WatchServiceInstallDeps, isNoWait: boolean): WatchServiceInstallReport {
  return installOn(deps, isNoWait, WatchServiceInstallOutcome.Installed);
}

/** Remove the watch from every scheduler that runs it here; its ledger is kept. */
export function uninstallWatchService(deps: WatchServiceInstallDeps): WatchServiceInstallReport {
  if (deps.platform === "win32") return runWindowsInstaller(deps, ["-Uninstall"], WatchServiceInstallOutcome.Removed);
  const paths = schedulePathsOf(deps);
  const removals: SchedulerOutcome[] = [];
  if (deps.platform === "darwin") removals.push(removeLaunchdAgent(paths, deps.uid ?? 0, deps.runCommand));
  if (isSystemdTimerInstalled(paths)) removals.push(removeSystemdTimer(paths, deps.runCommand));
  if (deps.platform !== "darwin") removals.push(removeCronLine(paths, deps.runCommand));
  const failure = removals.find((removal) => !removal.isDone);
  if (failure) return { outcome: WatchServiceInstallOutcome.Failed, detail: failure.detail };
  return { outcome: WatchServiceInstallOutcome.Removed, detail: removals.map((removal) => removal.detail).join("; ") };
}

/**
 * Act on `autoInstallWatchService` as an install or upgrade does, the same way
 * on every platform: `always` schedules the watch, a watch already scheduled is
 * refreshed for any value but `never` so an upgrade never leaves it on an old
 * launcher, `never` leaves the machine as it is, and `ask` adds nothing new.
 */
export function applyWatchServicePreference(
  preference: PreferenceValue,
  deps: WatchServiceInstallDeps,
  isNoWait: boolean,
): WatchServiceInstallReport {
  if (preference === PreferenceValue.Never) {
    return { outcome: WatchServiceInstallOutcome.TurnedOff, detail: "autoInstallWatchService is never" };
  }
  const installedScheduler = findInstalledScheduler(deps);
  if (!installedScheduler && preference !== PreferenceValue.Always) {
    return { outcome: WatchServiceInstallOutcome.NotRequested, detail: `autoInstallWatchService is ${preference} and the watch is not scheduled` };
  }
  return installOn(deps, isNoWait, installedScheduler ? WatchServiceInstallOutcome.Refreshed : WatchServiceInstallOutcome.Installed);
}
