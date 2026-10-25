import { createHash } from "crypto";
import { readFileSync } from "fs";
import { RELOAD_PLUGIN_SCOPE } from "./constants.js";
import type { PluginFingerprint } from "./types.js";

interface InstalledPluginEntry {
  scope?: unknown;
  version?: unknown;
  gitCommitSha?: unknown;
  lastUpdated?: unknown;
}

/**
 * A digest of every user-scope plugin's version, commit and update time, or
 * null when Claude's install record cannot be read. Project-scoped installs are
 * left out: they apply to one checkout, so a change there is no reason to
 * restart every session on the machine.
 *
 * Output shape: `{ fingerprint: "9f2c…", changedAtMs: 1792800216869 }`
 */
export function readPluginFingerprint(installedPluginsFile: string): PluginFingerprint | null {
  let plugins: Record<string, InstalledPluginEntry[]>;
  try {
    const parsed = JSON.parse(readFileSync(installedPluginsFile, "utf-8")) as { plugins?: unknown };
    if (!parsed.plugins || typeof parsed.plugins !== "object") return null;
    plugins = parsed.plugins as Record<string, InstalledPluginEntry[]>;
  } catch {
    return null;
  }
  const identities: string[] = [];
  let changedAtMs: number | undefined;
  for (const pluginName of Object.keys(plugins).sort()) {
    const installs = Array.isArray(plugins[pluginName]) ? plugins[pluginName] : [];
    for (const install of installs) {
      if (install.scope !== RELOAD_PLUGIN_SCOPE) continue;
      identities.push(`${pluginName}@${String(install.version)}#${String(install.gitCommitSha)}@${String(install.lastUpdated)}`);
      const updatedAtMs = typeof install.lastUpdated === "string" ? Date.parse(install.lastUpdated) : NaN;
      if (!Number.isNaN(updatedAtMs)) changedAtMs = Math.max(changedAtMs ?? 0, updatedAtMs);
    }
  }
  return {
    fingerprint: createHash("sha256").update(identities.join("\n")).digest("hex"),
    changedAtMs: changedAtMs,
  };
}
