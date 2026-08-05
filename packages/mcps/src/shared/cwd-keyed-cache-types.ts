/**
 * Shapes for caches stored in the Muggle home directory and keyed by working
 * directory.
 */

/** Identifies one cwd-keyed cache and the in-project file it superseded. */
export interface ICwdKeyedCache {
  /** File name under the Muggle home directory. */
  fileName: string;
  /** Property that held the entry in the superseded in-project file. */
  legacyEntryKey: string;
}

/**
 * On-disk shape of a cwd-keyed cache file.
 *
 * Output shape: `{ version: 1, entries: { "C:\\repo": { host, savedAt } } }`
 */
export interface ICwdKeyedCacheFile<TEntry> {
  version: number;
  entries: Record<string, TEntry>;
}
