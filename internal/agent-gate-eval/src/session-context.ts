/** Synthesizes the SessionStart context a skill session starts with. */

import * as fs from "node:fs";
import * as path from "node:path";

import { PREFERENCE_DEFAULTS_PATH, PREFERENCES_CONTEXT_HEADER } from "./constants.js";

/**
 * The SessionStart preferences block, as plugin/scripts/ensure-electron-app.sh
 * emits it: every shipped default, with the scenario's preferences set over them.
 *
 * Output shape:
 *
 *     Muggle Test Preferences (~/.muggle-ai/preferences.json):
 *     autoLogin=always … autoCreatePR=never … maxCatchUpRebases=20
 *
 * @throws when a scenario preference names no shipped preference — a typo there would otherwise be silently inert.
 */
export function buildPreferencesContext(
  pluginRoot: string,
  preferences: Record<string, string> | undefined,
): string {
  const defaults = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, PREFERENCE_DEFAULTS_PATH), "utf8"),
  ) as Record<string, string>;
  const unknownKeys = Object.keys(preferences ?? {}).filter((key) => !(key in defaults));
  if (unknownKeys.length > 0) {
    throw new Error(`Unknown preference(s) ${unknownKeys.join(", ")} — not in ${PREFERENCE_DEFAULTS_PATH}`);
  }
  const resolved = { ...defaults, ...preferences };
  const line = Object.entries(resolved)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  return `${PREFERENCES_CONTEXT_HEADER}\n${line}`;
}
