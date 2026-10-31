import { mkdtempSync, readdirSync, rmSync, statSync } from "fs";
import { join } from "path";
import {
  RUN_TEMP_ROOT_PREFIX,
  RUN_TEMP_ROOT_REMOVE_RETRIES,
  STALE_RUN_TEMP_ROOT_AGE_MS,
  TEMP_DIR_ENV_KEYS,
} from "./constants.js";

/**
 * Creates this run's temp root under the machine's real temp directory.
 * @returns the new root's absolute path
 */
export function createRunTempRoot(realTempDir: string): string {
  return mkdtempSync(join(realTempDir, RUN_TEMP_ROOT_PREFIX));
}

/** Points every env var `os.tmpdir()` reads at the run's temp root. */
export function pointTempEnvAt(env: NodeJS.ProcessEnv, runTempRoot: string): void {
  for (const envKey of TEMP_DIR_ENV_KEYS) {
    env[envKey] = runTempRoot;
  }
}

/**
 * Removes a run's temp root without ever failing the run.
 * @returns true when the root is gone, false when a process still holds a file inside it
 */
export function removeRunTempRoot(runTempRoot: string): boolean {
  try {
    rmSync(runTempRoot, { recursive: true, force: true, maxRetries: RUN_TEMP_ROOT_REMOVE_RETRIES });
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes run roots left behind by runs killed before their teardown ran.
 * @returns the roots removed
 */
export function sweepStaleRunTempRoots(realTempDir: string, nowMs: number): string[] {
  const removedRoots: string[] = [];
  for (const tempEntry of readdirSync(realTempDir, { withFileTypes: true })) {
    if (!tempEntry.isDirectory() || !tempEntry.name.startsWith(RUN_TEMP_ROOT_PREFIX)) continue;
    const candidateRoot = join(realTempDir, tempEntry.name);
    let lastModifiedMs: number;
    try {
      lastModifiedMs = statSync(candidateRoot).mtimeMs;
    } catch {
      // A concurrent run's teardown removed it between the listing and the stat.
      continue;
    }
    if (nowMs - lastModifiedMs > STALE_RUN_TEMP_ROOT_AGE_MS && removeRunTempRoot(candidateRoot)) {
      removedRoots.push(candidateRoot);
    }
  }
  return removedRoots;
}
