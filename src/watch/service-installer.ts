import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { WATCH_INSTALLER_RELATIVE_PATH, WATCH_INSTALLER_TIMEOUT_MS, WATCH_SCHEDULED_TASK_NAME } from "./constants.js";
import type { CommandOutcome, CommandRunner } from "./types.js";

/**
 * The installer script shipped with this package, found by walking up from this
 * module, so it resolves from the source tree and from the bundled `dist/` alike.
 */
export function findWatchInstallerScript(startDir: string = dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    const candidate = join(dir, WATCH_INSTALLER_RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

/** Whether the watch's scheduled task is registered for this user. */
export function isWatchTaskRegistered(runCommand: CommandRunner): boolean {
  return runCommand("schtasks.exe", ["/Query", "/TN", WATCH_SCHEDULED_TASK_NAME])?.exitCode === 0;
}

/**
 * Run the installer with `installerArgs` (`-NoWait`, `-Uninstall`, …) under
 * Windows PowerShell, keeping its stderr: a parse error or a throw says why only there.
 *
 * @returns The installer's outcome, or null when it could not start or timed out.
 */
export function runWatchInstaller(scriptPath: string, installerArgs: string[], runCommand: CommandRunner): CommandOutcome | null {
  return runCommand(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...installerArgs],
    { timeoutMs: WATCH_INSTALLER_TIMEOUT_MS, isStderrCaptured: true },
  );
}
