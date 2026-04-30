/**
 * Preferences service — read, write, merge, validate user preferences.
 *
 * Skills consume preferences via the SessionStart hook (zero tokens).
 * MCP tools import this service directly (zero tokens).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getDataDir } from "./data-dir.js";
import { getLogger } from "./logger.js";
import {
  PreferenceKey,
  type IPartialPreferences,
  type IPreferences,
  type IPreferencesFile,
} from "./preferences-types.js";
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_ALLOWED_VALUES,
  PREFERENCES_FILE_NAME,
  PREFERENCES_PROJECT_DIR_NAME,
  PREFERENCES_VERSION,
} from "./preferences-constants.js";

/**
 * Check whether the global preferences file exists.
 * @param dataDirOverride - Override data dir for testing.
 */
export function isFirstRun(dataDirOverride?: string): boolean {
  const filePath = path.join(dataDirOverride ?? getDataDir(), PREFERENCES_FILE_NAME);
  return !fs.existsSync(filePath);
}

/**
 * Read a preferences file from disk.
 * Returns empty preferences on any error.
 */
function readPreferencesFile(filePath: string): IPartialPreferences {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as IPreferencesFile;
    return raw.preferences ?? {};
  } catch (error) {
    getLogger().warn("Failed to read preferences file", {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

/**
 * Read global preferences from ~/.muggle-ai/preferences.json.
 * Missing keys are filled with defaults.
 * @param dataDirOverride - Override data dir for testing.
 */
export function readGlobalPreferences(dataDirOverride?: string): IPreferences {
  const filePath = path.join(dataDirOverride ?? getDataDir(), PREFERENCES_FILE_NAME);
  const partial = readPreferencesFile(filePath);
  return { ...DEFAULT_PREFERENCES, ...partial };
}

/**
 * Read per-project preference overrides from {cwd}/.muggle-ai/preferences.json.
 * Returns only the keys explicitly set in the project file.
 * @param cwd - Project root directory.
 */
export function readProjectPreferences(cwd: string): IPartialPreferences {
  const filePath = path.join(cwd, PREFERENCES_PROJECT_DIR_NAME, PREFERENCES_FILE_NAME);
  return readPreferencesFile(filePath);
}

/**
 * Resolve preferences: defaults → global → per-project (last wins).
 * @param dataDirOverride - Override data dir for testing.
 * @param cwd - Project root directory (optional).
 */
export function resolvePreferences(dataDirOverride?: string, cwd?: string): IPreferences {
  const global = readGlobalPreferences(dataDirOverride);
  if (!cwd) {
    return global;
  }
  const project = readProjectPreferences(cwd);
  return { ...global, ...project };
}

/**
 * Write preferences to the appropriate file.
 * @param prefs - Partial preferences to write (merged with existing).
 * @param scope - "global" or "project".
 * @param dataDirOverride - Override data dir for testing.
 * @param cwd - Project root (required when scope is "project").
 */
export function writePreferences(
  prefs: IPartialPreferences,
  scope: "global" | "project",
  dataDirOverride?: string,
  cwd?: string,
): void {
  const dir =
    scope === "project" && cwd
      ? path.join(cwd, PREFERENCES_PROJECT_DIR_NAME)
      : (dataDirOverride ?? getDataDir());

  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, PREFERENCES_FILE_NAME);

  const existing = readPreferencesFile(filePath);
  const merged = { ...existing, ...prefs };

  const file: IPreferencesFile = {
    version: PREFERENCES_VERSION,
    preferences: merged,
  };

  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

/**
 * Reset a preference key (or the entire file) back to defaults.
 * @param key - Key to reset, or undefined to reset the entire file.
 * @param scope - "global" or "project".
 * @param dataDirOverride - Override data dir for testing.
 * @param cwd - Project root (required when scope is "project").
 */
export function resetPreference(
  key: string | undefined,
  scope: "global" | "project",
  dataDirOverride?: string,
  cwd?: string,
): void {
  const dir =
    scope === "project" && cwd
      ? path.join(cwd, PREFERENCES_PROJECT_DIR_NAME)
      : (dataDirOverride ?? getDataDir());

  const filePath = path.join(dir, PREFERENCES_FILE_NAME);

  if (!fs.existsSync(filePath)) {
    return;
  }

  if (!key) {
    const file: IPreferencesFile = { version: PREFERENCES_VERSION, preferences: {} };
    fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
    return;
  }

  const existing = readPreferencesFile(filePath);
  delete existing[key as PreferenceKey];
  const file: IPreferencesFile = { version: PREFERENCES_VERSION, preferences: existing };
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

/**
 * Validate that a key and value are valid preferences. Per-key validation:
 * each key has its own set of allowed values (see PREFERENCE_ALLOWED_VALUES).
 */
export function validatePreference(key: string, value: string): boolean {
  const validKeys = Object.values(PreferenceKey) as string[];
  if (!validKeys.includes(key)) {
    return false;
  }
  const allowed = PREFERENCE_ALLOWED_VALUES[key as PreferenceKey] as readonly string[];
  return allowed.includes(value);
}

/**
 * Format resolved preferences as a compact one-liner for session context.
 */
export function formatPreferencesOneLiner(prefs: IPreferences): string {
  return Object.entries(prefs)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}
