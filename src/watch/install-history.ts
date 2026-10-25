import { readFileSync } from "fs";
import { INSTALL_LOADED_VERSION_PATTERN, INSTALL_STARTED_PATTERN } from "./constants.js";
import type { InstallRecord } from "./types.js";

/**
 * Every global muggle works install, oldest first, from `postinstall.log`. Only
 * blocks that pointed Claude's marketplace at the package count: npx and
 * project-local installs log too, but sessions never load from them. A missing
 * or unreadable log reads as no history.
 *
 * Output shape: `[{ atMs: 1792871116176, version: "5.26.0-staging.199" }]`
 */
export function readInstallHistory(installLogFile: string): InstallRecord[] {
  let installLog: string;
  try {
    installLog = readFileSync(installLogFile, "utf-8");
  } catch {
    return [];
  }
  const installs: InstallRecord[] = [];
  let blockStartedAtMs: number | undefined;
  for (const line of installLog.split(/\r?\n/)) {
    const started = line.match(INSTALL_STARTED_PATTERN);
    if (started) {
      const startedAtMs = Date.parse(started[1]);
      blockStartedAtMs = Number.isNaN(startedAtMs) ? undefined : startedAtMs;
      continue;
    }
    const loaded = line.match(INSTALL_LOADED_VERSION_PATTERN);
    if (loaded && blockStartedAtMs !== undefined) installs.push({ atMs: blockStartedAtMs, version: loaded[1] });
  }
  return installs;
}
