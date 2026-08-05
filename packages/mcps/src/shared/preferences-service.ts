/**
 * Preferences service — resolve, write, reset, validate user preferences.
 *
 * Preferences are user-level: they resolve from defaults overlaid by
 * ~/.muggle-ai/preferences.json and never from inside a project.
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
  ProjectPreferencesReconcileOutcome,
  type IProjectPreferencesReconcileReport,
} from "./project-preferences-reconcile-types.js";
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_ALLOWED_VALUES,
  PREFERENCES_FILE_NAME,
  PREFERENCES_PROJECT_DIR_NAME,
  PREFERENCES_VERSION,
} from "./preferences-constants.js";

function getGlobalPreferencesFilePath(dataDirOverride?: string): string {
  return path.join(dataDirOverride ?? getDataDir(), PREFERENCES_FILE_NAME);
}

/**
 * Check whether the global preferences file exists.
 * @param dataDirOverride - Override data dir for testing.
 */
export function isFirstRun(dataDirOverride?: string): boolean {
  return !fs.existsSync(getGlobalPreferencesFilePath(dataDirOverride));
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

function writePreferencesFile(filePath: string, prefs: IPartialPreferences): void {
  const file: IPreferencesFile = {
    version: PREFERENCES_VERSION,
    preferences: prefs,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, "utf-8");
}

/**
 * Resolve effective preferences: defaults overlaid by ~/.muggle-ai/preferences.json.
 * @param dataDirOverride - Override data dir for testing.
 */
export function resolvePreferences(dataDirOverride?: string): IPreferences {
  const saved = readPreferencesFile(getGlobalPreferencesFilePath(dataDirOverride));
  return { ...DEFAULT_PREFERENCES, ...saved };
}

/**
 * Write preferences to ~/.muggle-ai/preferences.json, merged over what is already there.
 * @param prefs - Partial preferences to write.
 * @param dataDirOverride - Override data dir for testing.
 */
export function writePreferences(prefs: IPartialPreferences, dataDirOverride?: string): void {
  const dir = dataDirOverride ?? getDataDir();
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, PREFERENCES_FILE_NAME);
  const existing = readPreferencesFile(filePath);
  writePreferencesFile(filePath, { ...existing, ...prefs });
}

/**
 * Reset a preference key (or the entire file) back to defaults.
 * @param key - Key to reset, or undefined to reset the entire file.
 * @param dataDirOverride - Override data dir for testing.
 */
export function resetPreference(key: string | undefined, dataDirOverride?: string): void {
  const filePath = getGlobalPreferencesFilePath(dataDirOverride);

  if (!fs.existsSync(filePath)) {
    return;
  }

  if (!key) {
    writePreferencesFile(filePath, {});
    return;
  }

  const existing = readPreferencesFile(filePath);
  delete existing[key as PreferenceKey];
  writePreferencesFile(filePath, existing);
}

/**
 * Reconcile a legacy `<cwd>/.muggle-ai/preferences.json` against global preferences.
 *
 * Copies the project file forward only when no global file exists yet. Merging it
 * into an existing global file would silently apply choices the user made for one
 * project to every other project, so those keys are reported back as shadowed
 * instead. The project file itself is never modified or deleted.
 *
 * @param cwd - Project root to inspect.
 * @param dataDirOverride - Override data dir for testing.
 */
export function reconcileProjectPreferences(
  cwd: string,
  dataDirOverride?: string,
): IProjectPreferencesReconcileReport {
  const projectFilePath = path.join(cwd, PREFERENCES_PROJECT_DIR_NAME, PREFERENCES_FILE_NAME);
  const projectPreferences = readPreferencesFile(projectFilePath);
  const projectKeys = Object.keys(projectPreferences) as PreferenceKey[];

  if (projectKeys.length === 0) {
    return {
      outcome: ProjectPreferencesReconcileOutcome.NoAction,
      projectFilePath: projectFilePath,
      shadowedKeys: [],
    };
  }

  if (isFirstRun(dataDirOverride)) {
    writePreferences(projectPreferences, dataDirOverride);
    return {
      outcome: ProjectPreferencesReconcileOutcome.CopiedToGlobal,
      projectFilePath: projectFilePath,
      shadowedKeys: [],
    };
  }

  const resolved = resolvePreferences(dataDirOverride);
  const shadowedKeys = projectKeys.filter((key) => projectPreferences[key] !== resolved[key]);

  return {
    outcome:
      shadowedKeys.length > 0
        ? ProjectPreferencesReconcileOutcome.KeysShadowed
        : ProjectPreferencesReconcileOutcome.NoAction,
    projectFilePath: projectFilePath,
    shadowedKeys: shadowedKeys,
  };
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
