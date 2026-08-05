/**
 * Last-used Muggle Test project, cached per working directory.
 *
 * Stored in the Muggle home directory under the absolute working directory, so
 * the user's project stays untouched. Honors the `autoSelectProject = always`
 * preference: when set, skills can silently reuse the project that the user
 * most recently picked for this directory, instead of presenting the project
 * picker every time.
 *
 * Skills consume this via the `Muggle Test Last Project` line injected into
 * session context by the SessionStart hook (zero tokens). MCP tools import this
 * module directly (zero tokens).
 */

import { clearCwdEntry, readCwdEntry, writeCwdEntry } from "./cwd-keyed-cache.js";
import { LAST_PROJECT_CACHE } from "./last-project-constants.js";
import type { ILastProject } from "./last-project-types.js";

export {
  LAST_PROJECT_CACHE,
  LAST_PROJECT_DIR_NAME,
  LAST_PROJECT_FILE_NAME,
  LAST_PROJECT_VERSION,
} from "./last-project-constants.js";
export type { ILastProject, ILastProjectFile } from "./last-project-types.js";

/**
 * Read the cached last project for a working directory.
 *
 * Returns null if no entry exists or the cache fails to parse.
 */
export function readLastProject(cwd: string): ILastProject | null {
  return readCwdEntry<ILastProject>(LAST_PROJECT_CACHE, cwd);
}

/**
 * Write the cached last project for a working directory.
 *
 * Creates the Muggle home directory if it doesn't exist. `savedAt` is set
 * automatically; the caller only provides project identity fields.
 */
export function writeLastProject(
  cwd: string,
  lastProject: Omit<ILastProject, "savedAt">,
): void {
  writeCwdEntry<ILastProject>(LAST_PROJECT_CACHE, cwd, {
    ...lastProject,
    savedAt: new Date().toISOString(),
  });
}

/**
 * Remove the cached last project for a working directory, including any
 * superseded in-project file.
 */
export function clearLastProject(cwd: string): void {
  clearCwdEntry(LAST_PROJECT_CACHE, cwd);
}

/**
 * Format a cached last project as a compact one-liner for session context.
 *
 * Returns an empty string if no cache exists. Quoting handles project names
 * that contain spaces or unusual characters.
 */
export function formatLastProjectOneLiner(cwd: string): string {
  const cached = readLastProject(cwd);
  if (!cached) {
    return "";
  }
  const safeName = cached.projectName.replace(/"/g, '\\"');
  return `Muggle Test Last Project: id=${cached.projectId} url=${cached.projectUrl} name="${safeName}"`;
}
