/** The identity recorded inside a lock file, so a stale lock can be told from a live one. */
export interface LockHolder {
  pid: number;
  host: string;
  acquiredAt: string;
}
