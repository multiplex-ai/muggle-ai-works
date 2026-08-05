/**
 * Home-directory storage for caches keyed by working directory.
 *
 * Each cache is a single `{ version, entries }` map file in the Muggle home
 * directory, mirroring the `prepare-plans.json` convention, so nothing is
 * written inside the user's project. A read that misses falls back to the
 * superseded in-project file and copies that entry forward, so an existing
 * project cache survives the move.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { CWD_KEYED_CACHE_VERSION, LEGACY_CACHE_DIR_NAME } from "./cwd-keyed-cache-constants.js";
import type { ICwdKeyedCache, ICwdKeyedCacheFile } from "./cwd-keyed-cache-types.js";
import { getDataDir } from "./data-dir.js";
import { getLogger } from "./logger.js";

function resolveHomeFilePath(cache: ICwdKeyedCache): string {
  return path.join(getDataDir(), cache.fileName);
}

function resolveLegacyFilePath(cache: ICwdKeyedCache, cwd: string): string {
  return path.join(cwd, LEGACY_CACHE_DIR_NAME, cache.fileName);
}

function parseJsonFile<TParsed>(filePath: string): TParsed | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as TParsed;
  } catch (error) {
    getLogger().warn("Failed to read cache file", {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function readHomeEntries<TEntry>(cache: ICwdKeyedCache): Record<string, TEntry> {
  const parsed = parseJsonFile<ICwdKeyedCacheFile<TEntry>>(resolveHomeFilePath(cache));
  return parsed?.entries ?? {};
}

function writeHomeEntries<TEntry>(
  cache: ICwdKeyedCache,
  entries: Record<string, TEntry>,
): void {
  fs.mkdirSync(getDataDir(), { recursive: true });
  const file: ICwdKeyedCacheFile<TEntry> = {
    version: CWD_KEYED_CACHE_VERSION,
    entries: entries,
  };
  fs.writeFileSync(
    resolveHomeFilePath(cache),
    `${JSON.stringify(file, null, 2)}\n`,
    "utf-8",
  );
}

function readLegacyEntry<TEntry>(cache: ICwdKeyedCache, cwd: string): TEntry | null {
  const parsed = parseJsonFile<Record<string, TEntry | undefined>>(
    resolveLegacyFilePath(cache, cwd),
  );
  return parsed?.[cache.legacyEntryKey] ?? null;
}

/**
 * Read the entry for a working directory, migrating a superseded in-project
 * entry into the home file on the way.
 * @param cache - Cache descriptor.
 * @param cwd - Working directory the entry is keyed on.
 * @returns The entry, or null when neither file holds one.
 */
export function readCwdEntry<TEntry>(cache: ICwdKeyedCache, cwd: string): TEntry | null {
  const cwdKey = path.resolve(cwd);
  const entries = readHomeEntries<TEntry>(cache);
  const homeEntry = entries[cwdKey];
  if (homeEntry) {
    return homeEntry;
  }

  const legacyEntry = readLegacyEntry<TEntry>(cache, cwd);
  if (!legacyEntry) {
    return null;
  }

  try {
    writeHomeEntries<TEntry>(cache, { ...entries, [cwdKey]: legacyEntry });
  } catch (error) {
    // A home directory that cannot be written still yields a usable entry.
    getLogger().warn("Failed to migrate cache entry to the home directory", {
      path: resolveHomeFilePath(cache),
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return legacyEntry;
}

/**
 * Write the entry for a working directory into the home file.
 * @param cache - Cache descriptor.
 * @param cwd - Working directory the entry is keyed on.
 * @param entry - Entry to store.
 */
export function writeCwdEntry<TEntry>(
  cache: ICwdKeyedCache,
  cwd: string,
  entry: TEntry,
): void {
  const entries = readHomeEntries<TEntry>(cache);
  writeHomeEntries<TEntry>(cache, { ...entries, [path.resolve(cwd)]: entry });
}

/**
 * Remove the entry for a working directory from the home file and delete the
 * superseded in-project file.
 * @param cache - Cache descriptor.
 * @param cwd - Working directory the entry is keyed on.
 */
export function clearCwdEntry(cache: ICwdKeyedCache, cwd: string): void {
  const entries = readHomeEntries<unknown>(cache);
  const cwdKey = path.resolve(cwd);
  if (cwdKey in entries) {
    delete entries[cwdKey];
    writeHomeEntries<unknown>(cache, entries);
  }

  // Left in place, the in-project file would be migrated back on the next read.
  const legacyFilePath = resolveLegacyFilePath(cache, cwd);
  if (fs.existsSync(legacyFilePath)) {
    fs.unlinkSync(legacyFilePath);
  }
}
