import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  GLOBAL_MUGGLE_ENTRY_RELATIVE_PATH,
  PACKAGE_MUGGLE_ENTRY_RELATIVE_PATH,
  WATCH_INSTALLER_TIMEOUT_MS,
  WATCH_SCHEDULED_TASK_NAME,
} from "./constants.js";
import type { CommandOutcome, CommandRunner } from "./types.js";

/**
 * A file shipped with this package, found by walking up from this module, so it
 * resolves from the source tree and from the bundled `dist/` alike.
 */
export function findShippedFile(relativePath: string, startDir: string = dirname(fileURLToPath(import.meta.url))): string | null {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

/**
 * The muggle entry point a scheduler should run: the global install's, whose
 * path survives upgrades, or this package's own when there is none.
 */
export function resolveScheduledMuggleEntry(runCommand: CommandRunner): string | null {
  const globalRoot = runCommand("npm", ["root", "-g"])?.stdout.trim();
  const globalEntry = globalRoot ? join(globalRoot, GLOBAL_MUGGLE_ENTRY_RELATIVE_PATH) : undefined;
  if (globalEntry && existsSync(globalEntry)) return globalEntry;
  return findShippedFile(PACKAGE_MUGGLE_ENTRY_RELATIVE_PATH);
}

/** Whether the watch's scheduled task is registered for this Windows user. */
export function isWatchTaskRegistered(runCommand: CommandRunner): boolean {
  return runCommand("schtasks.exe", ["/Query", "/TN", WATCH_SCHEDULED_TASK_NAME])?.exitCode === 0;
}

/**
 * Run the Windows installer with `installerArgs` (`-NoWait`, `-Uninstall`, …)
 * under Windows PowerShell, keeping its stderr: a parse error or a throw says why only there.
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
