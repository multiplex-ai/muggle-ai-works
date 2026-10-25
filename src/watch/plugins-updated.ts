import { readFileSync } from "fs";
import { RELOAD_PLUGIN_SCOPE } from "./constants.js";

interface InstalledPluginEntry {
  scope?: unknown;
  lastUpdated?: unknown;
}

/**
 * When a user-scope plugin was last installed or updated, per Claude's install
 * record; undefined when the record cannot be read or dates nothing. Project-scoped
 * installs are left out: they apply to one checkout, so a change there is no
 * reason to restart every session on the machine.
 */
export function readUserPluginsUpdatedAtMs(installedPluginsFile: string): number | undefined {
  let plugins: Record<string, InstalledPluginEntry[]>;
  try {
    const parsed = JSON.parse(readFileSync(installedPluginsFile, "utf-8")) as { plugins?: unknown };
    if (!parsed.plugins || typeof parsed.plugins !== "object") return undefined;
    plugins = parsed.plugins as Record<string, InstalledPluginEntry[]>;
  } catch {
    return undefined;
  }
  let updatedAtMs: number | undefined;
  for (const installs of Object.values(plugins)) {
    for (const install of Array.isArray(installs) ? installs : []) {
      if (install.scope !== RELOAD_PLUGIN_SCOPE) continue;
      const installUpdatedAtMs = typeof install.lastUpdated === "string" ? Date.parse(install.lastUpdated) : NaN;
      if (!Number.isNaN(installUpdatedAtMs)) updatedAtMs = Math.max(updatedAtMs ?? 0, installUpdatedAtMs);
    }
  }
  return updatedAtMs;
}
