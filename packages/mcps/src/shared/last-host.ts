/**
 * Per-repo last-used local dev server URL cache.
 *
 * Lives at `<repo>/.muggle-ai/last-host.json`. Honors `localDevHost = always`:
 * when set, skills silently reuse the URL the user used last time in this repo
 * instead of prompting again. Cache is updated on every pick — independent of
 * the "Remember this URL?" Picker 2 — so `Use {lastHost}` always shows the
 * most recent run's URL.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getLogger } from "./logger.js";

export const LAST_HOST_FILE_NAME = "last-host.json";
export const LAST_HOST_DIR_NAME = ".muggle-ai";
export const LAST_HOST_VERSION = 1;

export interface ILastHost {
  host: string;
  savedAt: string;
}

export interface ILastHostFile {
  version: number;
  lastHost: ILastHost;
}

/** Read the cached last host. Null if missing or unparseable. */
export function readLastHost(cwd: string): ILastHost | null {
  const filePath = path.join(cwd, LAST_HOST_DIR_NAME, LAST_HOST_FILE_NAME);
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as ILastHostFile;
    return raw.lastHost ?? null;
  } catch (error) {
    getLogger().warn("Failed to read last-host file", {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/** Write the cached last host. Creates the `.muggle-ai/` dir if needed. */
export function writeLastHost(cwd: string, host: string): void {
  const dir = path.join(cwd, LAST_HOST_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, LAST_HOST_FILE_NAME);
  const file: ILastHostFile = {
    version: LAST_HOST_VERSION,
    lastHost: { host, savedAt: new Date().toISOString() },
  };
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

/** Remove the cached last host. No-op if missing. */
export function clearLastHost(cwd: string): void {
  const filePath = path.join(cwd, LAST_HOST_DIR_NAME, LAST_HOST_FILE_NAME);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/** Compact one-liner for session context. Empty string if no cache. */
export function formatLastHostOneLiner(cwd: string): string {
  const cached = readLastHost(cwd);
  if (!cached) {
    return "";
  }
  return `Muggle Last Host: ${cached.host}`;
}
