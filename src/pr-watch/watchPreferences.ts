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
  WATCHER_LIFETIME_PREFERENCE_KEY,
  WATCHER_LIFETIME_SECONDS,
} from "./constants.js";
import { asRecord, readJsonRecord } from "./slotFiles.js";
import type { WatchPreferences } from "./types.js";

/** A `maxCatchUpRebases` value as a cap: null for `never`, undefined when it is neither that nor a positive integer. */
export function parseMaxCatchUpRebases(configuredValue: unknown): number | null | undefined {
  if (configuredValue === UNBOUNDED_PREFERENCE_VALUE) return null;
  const spelled = typeof configuredValue === "number" ? String(configuredValue) : configuredValue;
  return typeof spelled === "string" && POSITIVE_INTEGER.test(spelled) ? Number(spelled) : undefined;
}

const readUserPreferences = (homeDir: string): Record<string, unknown> =>
  asRecord(readJsonRecord(join(homeDir, ...USER_PREFERENCES_PATH_SEGMENTS)).preferences);

function readPreferenceLayers(homeDir: string, pluginRoot: string): Record<string, unknown>[] {
  return [readUserPreferences(homeDir), readJsonRecord(join(pluginRoot, ...PREFERENCE_DEFAULTS_PATH_SEGMENTS))];
}

function pickPreferenceValue(preferenceLayers: Record<string, unknown>[], preferenceKey: string): string | undefined {
  const configuredValue = preferenceLayers.map((layer) => layer[preferenceKey]).find((layerValue) => layerValue != null);
  return typeof configuredValue === "string" ? configuredValue : undefined;
}

/**
 * One string preference as the session's preferences line resolves it: the user's
 * `~/.muggle-ai/preferences.json` over the plugin's shipped defaults.
 *
 * @returns The configured value (e.g. `"always"`), or undefined when neither layer sets a string
 */
export function resolvePreferenceValue(
  preferenceKey: string,
  homeDir: string = homedir(),
  pluginRoot: string = resolvePluginRoot(),
): string | undefined {
  return pickPreferenceValue(readPreferenceLayers(homeDir, pluginRoot), preferenceKey);
}

/**
 * One string preference as the user's own `~/.muggle-ai/preferences.json` sets it, ignoring the shipped defaults —
 * for behavior that only an explicit choice may switch on.
 *
 * @returns The user's value, or undefined when their file does not set a string for it
 */
export function resolveUserPreferenceValue(preferenceKey: string, homeDir: string = homedir()): string | undefined {
  return pickPreferenceValue([readUserPreferences(homeDir)], preferenceKey);
}

/**
 * The watch's preferences: the user's `~/.muggle-ai/preferences.json` over the plugin's shipped defaults, the same
 * resolution the session's preferences line comes from. An invalid user value falls back to the default.
 */
export function resolveWatchPreferences(
  homeDir: string = homedir(),
  pluginRoot: string = resolvePluginRoot(),
): WatchPreferences {
  const preferenceLayers = readPreferenceLayers(homeDir, pluginRoot);
  const [userPreferences, shippedDefaults] = preferenceLayers;
  const autoRebase = pickPreferenceValue(preferenceLayers, AUTO_REBASE_PREFERENCE_KEY);
  const userCap = parseMaxCatchUpRebases(userPreferences[MAX_CATCH_UP_REBASES_PREFERENCE_KEY]);
  const shippedCap = parseMaxCatchUpRebases(shippedDefaults[MAX_CATCH_UP_REBASES_PREFERENCE_KEY]);
  const lifetimeSecondsOf = (configuredValue: unknown): number | undefined =>
    typeof configuredValue === "string" ? WATCHER_LIFETIME_SECONDS[configuredValue] : undefined;
  return {
    autoRebase: autoRebase,
    maxCatchUpRebases: userCap !== undefined ? userCap : (shippedCap ?? null),
    watcherLifetimeSeconds:
      lifetimeSecondsOf(userPreferences[WATCHER_LIFETIME_PREFERENCE_KEY]) ?? lifetimeSecondsOf(shippedDefaults[WATCHER_LIFETIME_PREFERENCE_KEY]),
  };
}
