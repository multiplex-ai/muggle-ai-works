import { homedir } from "os";
import { join } from "path";
import { resolvePluginRoot } from "../plugin-root/pluginRoot.js";
import {
  AUTO_REBASE_PREFERENCE_KEY,
  MAX_CATCH_UP_REBASES_PREFERENCE_KEY,
  POSITIVE_INTEGER,
  PREFERENCE_DEFAULTS_PATH_SEGMENTS,
  UNBOUNDED_PREFERENCE_VALUE,
  USER_PREFERENCES_PATH_SEGMENTS,
} from "./constants.js";
import { asRecord, readJsonRecord } from "./slotFiles.js";
import type { WatchPreferences } from "./types.js";

/** A `maxCatchUpRebases` value as a cap: null for `never`, undefined when it is neither that nor a positive integer. */
export function parseMaxCatchUpRebases(configuredValue: unknown): number | null | undefined {
  if (configuredValue === UNBOUNDED_PREFERENCE_VALUE) return null;
  const spelled = typeof configuredValue === "number" ? String(configuredValue) : configuredValue;
  return typeof spelled === "string" && POSITIVE_INTEGER.test(spelled) ? Number(spelled) : undefined;
}

/**
 * The watch's preferences: the user's `~/.muggle-ai/preferences.json` over the plugin's shipped defaults, the same
 * resolution the session's preferences line comes from. An invalid user value falls back to the default.
 */
export function resolveWatchPreferences(
  homeDir: string = homedir(),
  pluginRoot: string = resolvePluginRoot(),
): WatchPreferences {
  const shippedDefaults = readJsonRecord(join(pluginRoot, ...PREFERENCE_DEFAULTS_PATH_SEGMENTS));
  const userPreferences = asRecord(readJsonRecord(join(homeDir, ...USER_PREFERENCES_PATH_SEGMENTS)).preferences);
  const autoRebase = userPreferences[AUTO_REBASE_PREFERENCE_KEY] ?? shippedDefaults[AUTO_REBASE_PREFERENCE_KEY];
  const userCap = parseMaxCatchUpRebases(userPreferences[MAX_CATCH_UP_REBASES_PREFERENCE_KEY]);
  const shippedCap = parseMaxCatchUpRebases(shippedDefaults[MAX_CATCH_UP_REBASES_PREFERENCE_KEY]);
  return {
    autoRebase: typeof autoRebase === "string" ? autoRebase : undefined,
    maxCatchUpRebases: userCap !== undefined ? userCap : (shippedCap ?? null),
  };
}
