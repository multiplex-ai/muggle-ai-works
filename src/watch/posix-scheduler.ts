import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  WATCH_CRON_MARKER,
  WATCH_ENV_FILE,
  WATCH_LAUNCHD_LABEL,
  WATCH_SYSTEMD_UNIT_NAME,
  WATCH_TICK_LAUNCHER_FILE,
} from "./constants.js";
import {
  renderCronLine,
  renderLaunchdPlist,
  renderSystemdService,
  renderSystemdTimer,
  renderWatchEnvFile,
} from "./schedule-files.js";
import type { CommandRunner, PosixSchedulePaths, PosixTickJob, SchedulerOutcome } from "./types.js";

/** Where launchd, systemd and the crontab staging file live for this user. */
export function resolvePosixSchedulePaths(homeDir: string, env: NodeJS.ProcessEnv, watchBinDir: string): PosixSchedulePaths {
  const configHome = env.XDG_CONFIG_HOME || join(homeDir, ".config");
  return {
    launchdPlistFile: join(homeDir, "Library", "LaunchAgents", `${WATCH_LAUNCHD_LABEL}.plist`),
    systemdServiceFile: join(configHome, "systemd", "user", `${WATCH_SYSTEMD_UNIT_NAME}.service`),
    systemdTimerFile: join(configHome, "systemd", "user", `${WATCH_SYSTEMD_UNIT_NAME}.timer`),
    crontabStagingFile: join(watchBinDir, "crontab.txt"),
  };
}

/**
 * Copy the shipped launcher into the watch dir's `bin` — schedulers then never
 * point into a package dir an upgrade replaces — and record the PATH it restores.
 *
 * @returns The staged launcher's path.
 */
export function stageTickLauncher(launcherSourcePath: string, watchBinDir: string, pathValue: string): string {
  mkdirSync(watchBinDir, { recursive: true });
  const launcherPath = join(watchBinDir, WATCH_TICK_LAUNCHER_FILE);
  copyFileSync(launcherSourcePath, launcherPath);
  writeFileSync(join(watchBinDir, WATCH_ENV_FILE), renderWatchEnvFile(pathValue));
  return launcherPath;
}

function failed(step: string, outcome: ReturnType<CommandRunner>): SchedulerOutcome {
  const reason = outcome ? outcome.stdout.trim() || `exit ${outcome.exitCode}` : "did not run";
  return { isDone: false, detail: `${step} failed: ${reason}` };
}

/**
 * Write the launchd agent and (re)load it in the user's GUI domain. Booting out
 * the old copy first makes a re-install replace it in place.
 */
export function installLaunchdAgent(job: PosixTickJob, paths: PosixSchedulePaths, uid: number, runCommand: CommandRunner): SchedulerOutcome {
  mkdirSync(dirname(paths.launchdPlistFile), { recursive: true });
  writeFileSync(paths.launchdPlistFile, renderLaunchdPlist(job));
  runCommand("launchctl", ["bootout", `gui/${uid}/${WATCH_LAUNCHD_LABEL}`]);
  const loaded = runCommand("launchctl", ["bootstrap", `gui/${uid}`, paths.launchdPlistFile], { isStderrCaptured: true });
  if (loaded?.exitCode !== 0) return failed("launchctl bootstrap", loaded);
  return { isDone: true, detail: `launchd agent ${WATCH_LAUNCHD_LABEL} loaded, every ${job.intervalSeconds / 60} min` };
}

/** Unload the launchd agent and delete its plist. */
export function removeLaunchdAgent(paths: PosixSchedulePaths, uid: number, runCommand: CommandRunner): SchedulerOutcome {
  runCommand("launchctl", ["bootout", `gui/${uid}/${WATCH_LAUNCHD_LABEL}`]);
  rmSync(paths.launchdPlistFile, { force: true });
  return { isDone: true, detail: `launchd agent ${WATCH_LAUNCHD_LABEL} removed` };
}

/** Whether `systemctl --user` can manage units in this session; a container or a host without systemd cannot. */
export function isSystemdUserAvailable(runCommand: CommandRunner): boolean {
  return runCommand("systemctl", ["--user", "show-environment"])?.exitCode === 0;
}

/** Write the systemd user service and timer, then enable and start the timer. */
export function installSystemdTimer(job: PosixTickJob, paths: PosixSchedulePaths, runCommand: CommandRunner): SchedulerOutcome {
  mkdirSync(dirname(paths.systemdTimerFile), { recursive: true });
  writeFileSync(paths.systemdServiceFile, renderSystemdService(job));
  writeFileSync(paths.systemdTimerFile, renderSystemdTimer(job));
  const reloaded = runCommand("systemctl", ["--user", "daemon-reload"], { isStderrCaptured: true });
  if (reloaded?.exitCode !== 0) return failed("systemctl --user daemon-reload", reloaded);
  const enabled = runCommand("systemctl", ["--user", "enable", "--now", `${WATCH_SYSTEMD_UNIT_NAME}.timer`], { isStderrCaptured: true });
  if (enabled?.exitCode !== 0) return failed(`systemctl --user enable ${WATCH_SYSTEMD_UNIT_NAME}.timer`, enabled);
  return { isDone: true, detail: `systemd user timer ${WATCH_SYSTEMD_UNIT_NAME}.timer enabled, every ${job.intervalSeconds / 60} min` };
}

/** Stop and disable the timer and delete both units. */
export function removeSystemdTimer(paths: PosixSchedulePaths, runCommand: CommandRunner): SchedulerOutcome {
  runCommand("systemctl", ["--user", "disable", "--now", `${WATCH_SYSTEMD_UNIT_NAME}.timer`]);
  rmSync(paths.systemdTimerFile, { force: true });
  rmSync(paths.systemdServiceFile, { force: true });
  runCommand("systemctl", ["--user", "daemon-reload"]);
  return { isDone: true, detail: `systemd user timer ${WATCH_SYSTEMD_UNIT_NAME}.timer removed` };
}

/** Whether this machine has a `crontab` command to schedule with. */
export function isCrontabAvailable(runCommand: CommandRunner): boolean {
  return readCrontabLines(runCommand) !== null;
}

// `crontab -l` exits 1 with no table at all, which reads as an empty one; only a
// missing crontab binary means cron cannot be used.
function readCrontabLines(runCommand: CommandRunner): string[] | null {
  const listed = runCommand("crontab", ["-l"]);
  if (listed === null) return null;
  return listed.exitCode === 0 ? listed.stdout.split("\n").filter((line) => line.trim() !== "") : [];
}

function writeCrontabLines(lines: string[], paths: PosixSchedulePaths, runCommand: CommandRunner): ReturnType<CommandRunner> {
  mkdirSync(dirname(paths.crontabStagingFile), { recursive: true });
  writeFileSync(paths.crontabStagingFile, `${lines.join("\n")}\n`);
  const installed = runCommand("crontab", [paths.crontabStagingFile], { isStderrCaptured: true });
  rmSync(paths.crontabStagingFile, { force: true });
  return installed;
}

/** Add the watch's marked line to the user's crontab, replacing an earlier one and keeping every other line. */
export function installCronLine(job: PosixTickJob, paths: PosixSchedulePaths, runCommand: CommandRunner): SchedulerOutcome {
  const lines = readCrontabLines(runCommand);
  if (lines === null) return { isDone: false, detail: "no crontab command on this machine" };
  const written = writeCrontabLines([...lines.filter((line) => !line.endsWith(WATCH_CRON_MARKER)), renderCronLine(job)], paths, runCommand);
  if (written?.exitCode !== 0) return failed("crontab", written);
  return { isDone: true, detail: `crontab line added, every ${job.intervalSeconds / 60} min` };
}

/** Remove the watch's marked line from the user's crontab, if it has one. */
export function removeCronLine(paths: PosixSchedulePaths, runCommand: CommandRunner): SchedulerOutcome {
  const lines = readCrontabLines(runCommand);
  if (lines === null || !lines.some((line) => line.endsWith(WATCH_CRON_MARKER))) return { isDone: true, detail: "no crontab line" };
  const written = writeCrontabLines(lines.filter((line) => !line.endsWith(WATCH_CRON_MARKER)), paths, runCommand);
  if (written?.exitCode !== 0) return failed("crontab", written);
  return { isDone: true, detail: "crontab line removed" };
}

/** Whether the user's crontab carries the watch's line. */
export function isCronLineInstalled(runCommand: CommandRunner): boolean {
  return (readCrontabLines(runCommand) ?? []).some((line) => line.endsWith(WATCH_CRON_MARKER));
}

/** Whether the watch's launchd agent is installed. */
export function isLaunchdAgentInstalled(paths: PosixSchedulePaths): boolean {
  return existsSync(paths.launchdPlistFile);
}

/** Whether the watch's systemd user timer is installed. */
export function isSystemdTimerInstalled(paths: PosixSchedulePaths): boolean {
  return existsSync(paths.systemdTimerFile);
}
