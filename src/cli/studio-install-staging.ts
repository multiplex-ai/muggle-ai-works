/**
 * Staged Studio installs: a download is verified and extracted in its own directory,
 * and touches the install only once it has been accepted.
 */

import { existsSync, mkdirSync, renameSync, rmSync } from "fs";
import * as path from "path";
import { setTimeout as delay } from "timers/promises";

import { getDataDir } from "../../packages/mcps/src/index.js";
import {
  INSTALL_MOVE_MAX_ATTEMPTS,
  INSTALL_MOVE_RETRY_DELAY_MS,
  INSTALL_MOVE_RETRYABLE_ERROR_CODES,
  RETIRED_INSTALL_SUFFIX,
  STUDIO_STAGING_DIR_NAME,
} from "./studio-install-staging-constants.js";

/**
 * Get the directory a version is staged in before it replaces its install.
 * @param versionDir - The install directory the staged version is headed for.
 * @returns Path of the staging directory, on the same volume as the install.
 */
export function getStudioStagingDir (versionDir: string): string {
  return path.join(getDataDir(), STUDIO_STAGING_DIR_NAME, path.basename(versionDir));
}

/**
 * Get the directory an install moves to while its replacement moves in.
 * @param stagingDir - The staging directory of the replacement.
 * @returns Path of the retired install, beside the staging directory.
 */
function getRetiredInstallDir (stagingDir: string): string {
  return `${stagingDir}${RETIRED_INSTALL_SUFFIX}`;
}

/**
 * Create an empty staging directory, clearing whatever a crashed run left there.
 * A run killed in the middle of a swap leaves the only copy of the install retired,
 * so that copy moves back instead of being cleared.
 * @param params - Preparation inputs.
 * @param params.stagingDir - The staging directory.
 * @param params.versionDir - The install the staged version is headed for.
 */
export function prepareStudioStagingDir (params: { stagingDir: string; versionDir: string }): void {
  const { stagingDir, versionDir } = params;
  const retiredDir = getRetiredInstallDir(stagingDir);

  if (existsSync(retiredDir) && !existsSync(versionDir)) {
    renameSync(retiredDir, versionDir);
  }

  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(retiredDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
}

/**
 * Remove a staging directory after a refused or failed install.
 * @param stagingDir - The staging directory.
 */
export function discardStudioStagingDir (stagingDir: string): void {
  try {
    rmSync(stagingDir, { recursive: true, force: true });
  } catch {
    // Best effort: the next install clears it, and the failure being reported matters more.
  }
}

/**
 * Move a directory, waiting out the brief locks antivirus holds on new files.
 * @param fromDir - Directory to move.
 * @param toDir - Where it goes.
 */
async function moveDirectory (fromDir: string, toDir: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(fromDir, toDir);
      return;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= INSTALL_MOVE_MAX_ATTEMPTS || !INSTALL_MOVE_RETRYABLE_ERROR_CODES.has(errorCode)) {
        throw error;
      }
      await delay(INSTALL_MOVE_RETRY_DELAY_MS);
    }
  }
}

/**
 * Replace an install with an accepted staged version, restoring the old one if the swap fails.
 *
 * @param params - Swap inputs.
 * @param params.stagingDir - The accepted staged version.
 * @param params.versionDir - The install to replace, which may not exist yet.
 * @throws Error when the install cannot be replaced; it is then left as it was.
 */
export async function replaceStudioInstall (params: { stagingDir: string; versionDir: string }): Promise<void> {
  const { stagingDir, versionDir } = params;
  mkdirSync(path.dirname(versionDir), { recursive: true });

  if (!existsSync(versionDir)) {
    await moveDirectory(stagingDir, versionDir);
    return;
  }

  const retiredDir = getRetiredInstallDir(stagingDir);
  try {
    await moveDirectory(versionDir, retiredDir);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not replace the install at ${versionDir}, which may be in use. It was left as it was: ${errorMessage}`,
      { cause: error },
    );
  }

  try {
    await moveDirectory(stagingDir, versionDir);
  } catch (error) {
    await moveDirectory(retiredDir, versionDir);
    throw error;
  }

  try {
    rmSync(retiredDir, { recursive: true, force: true });
  } catch {
    // The install already succeeded; the next one clears a leftover it could not delete.
  }
}
