/**
 * Per-repo last-used Muggle project cache.
 *
 * Stored at `<repo>/.muggle-ai/last-project.json`. Honors the
 * `autoSelectProject = always` preference: when set, skills can silently reuse
 * the project that the user most recently picked for this repo, instead of
 * presenting the project picker every time.
 *
 * Skills consume this via the `Muggle Last Project` line injected into session
 * context by the SessionStart hook (zero tokens). MCP tools import this module
 * directly (zero tokens).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getLogger } from "./logger.js";

/** Per-repo cache file name. */
export const LAST_PROJECT_FILE_NAME = "last-project.json";
/** Per-repo cache directory name (shared with project preferences). */
export const LAST_PROJECT_DIR_NAME = ".muggle-ai";
/** Schema version for future migrations. */
export const LAST_PROJECT_VERSION = 1;

/** A cached "last used project" record for a single repo. */
export interface ILastProject {
  projectId: string;
  projectUrl: string;
  projectName: string;
  /** ISO-8601 timestamp of when this entry was last written. */
  savedAt: string;
}

/** On-disk file shape. */
export interface ILastProjectFile {
  version: number;
  lastProject: ILastProject;
}

/**
 * Read the cached last project for a repo.
 *
 * Returns null if the file does not exist or fails to parse.
 */
export function readLastProject(cwd: string): ILastProject | null {
  const filePath = path.join(cwd, LAST_PROJECT_DIR_NAME, LAST_PROJECT_FILE_NAME);
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as ILastProjectFile;
    return raw.lastProject ?? null;
  } catch (error) {
    getLogger().warn("Failed to read last-project file", {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Write the cached last project for a repo.
 *
 * Creates the `.muggle-ai/` directory if it doesn't exist. `savedAt` is set
 * automatically; the caller only provides project identity fields.
 */
export function writeLastProject(
  cwd: string,
  lastProject: Omit<ILastProject, "savedAt">,
): void {
  const dir = path.join(cwd, LAST_PROJECT_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, LAST_PROJECT_FILE_NAME);
  const file: ILastProjectFile = {
    version: LAST_PROJECT_VERSION,
    lastProject: { ...lastProject, savedAt: new Date().toISOString() },
  };
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

/**
 * Remove the cached last project for a repo. No-op if the file does not exist.
 */
export function clearLastProject(cwd: string): void {
  const filePath = path.join(cwd, LAST_PROJECT_DIR_NAME, LAST_PROJECT_FILE_NAME);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
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
  return `Muggle Last Project: id=${cached.projectId} url=${cached.projectUrl} name="${safeName}"`;
}
