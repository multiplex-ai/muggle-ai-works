import { readFileSync } from "fs";
import { MUGGLE_PLUGIN_ID, RELOAD_PLUGIN_SCOPE } from "./constants.js";

interface InstalledPluginEntry {
  scope?: unknown;
  lastUpdated?: unknown;
}

/**
 * When the muggle plugin was last installed or updated at user scope, per
 * Claude's install record; undefined when the record cannot be read or dates
 * nothing. Other plugins are left out — an auto-update of one is no reason to
 * restart every session on the machine — and so are project-scoped installs,
 * which apply to one checkout.
 */
export function readMugglePluginUpdatedAtMs(installedPluginsFile: string): number | undefined {
  let installs: unknown;
  try {
    const parsed = JSON.parse(readFileSync(installedPluginsFile, "utf-8")) as { plugins?: unknown };
    if (!parsed.plugins || typeof parsed.plugins !== "object") return undefined;
    installs = (parsed.plugins as Record<string, unknown>)[MUGGLE_PLUGIN_ID];
  } catch {
    return undefined;
  }
  let updatedAtMs: number | undefined;
  for (const install of Array.isArray(installs) ? (installs as InstalledPluginEntry[]) : []) {
    if (install.scope !== RELOAD_PLUGIN_SCOPE) continue;
    const installUpdatedAtMs = typeof install.lastUpdated === "string" ? Date.parse(install.lastUpdated) : NaN;
    if (!Number.isNaN(installUpdatedAtMs)) updatedAtMs = Math.max(updatedAtMs ?? 0, installUpdatedAtMs);
  }
  return updatedAtMs;
}
