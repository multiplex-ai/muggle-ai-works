/**
 * Last-used local dev server URL, cached per working directory.
 *
 * Stored in the Muggle home directory under the absolute working directory, so
 * the user's project stays untouched. Honors `autoSelectLocalHost = always`:
 * when set, skills silently reuse the URL the user used last time in this
 * directory instead of prompting again. The cache is updated on every pick —
 * independent of the "Remember this URL?" Picker 2 — so `Use {lastHost}` always
 * shows the most recent run's URL.
 */

import { clearCwdEntry, readCwdEntry, writeCwdEntry } from "./cwd-keyed-cache.js";
import { LAST_HOST_CACHE } from "./last-host-constants.js";
import type { ILastHost } from "./last-host-types.js";

export {
  LAST_HOST_CACHE,
  LAST_HOST_DIR_NAME,
  LAST_HOST_FILE_NAME,
  LAST_HOST_VERSION,
} from "./last-host-constants.js";
export type { ILastHost, ILastHostFile } from "./last-host-types.js";

/** Read the cached last host. Null if missing or unparseable. */
export function readLastHost(cwd: string): ILastHost | null {
  return readCwdEntry<ILastHost>(LAST_HOST_CACHE, cwd);
}

/** Write the cached last host. Creates the Muggle home directory if needed. */
export function writeLastHost(cwd: string, host: string): void {
  writeCwdEntry<ILastHost>(LAST_HOST_CACHE, cwd, {
    host: host,
    savedAt: new Date().toISOString(),
  });
}

/** Remove the cached last host, including any superseded in-project file. */
export function clearLastHost(cwd: string): void {
  clearCwdEntry(LAST_HOST_CACHE, cwd);
}

/** Compact one-liner for session context. Empty string if no cache. */
export function formatLastHostOneLiner(cwd: string): string {
  const cached = readLastHost(cwd);
  if (!cached) {
    return "";
  }
  return `Muggle Test Last Host: ${cached.host}`;
}
