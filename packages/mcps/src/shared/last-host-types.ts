/** Shapes for the last-used local dev server URL cache. */

/** A cached "last used host" record for a single working directory. */
export interface ILastHost {
  host: string;
  /** ISO-8601 timestamp of when this entry was last written. */
  savedAt: string;
}

/** Shape of the superseded in-project cache file. */
export interface ILastHostFile {
  version: number;
  lastHost: ILastHost;
}
