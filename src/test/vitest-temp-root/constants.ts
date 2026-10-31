/** Directory-name prefix of a run's temp root under the machine's real temp directory. */
export const RUN_TEMP_ROOT_PREFIX = "muggle-vitest-";

/** Key the global setup provides the run's temp root under, and every worker injects it from. */
export const RUN_TEMP_ROOT_CONTEXT_KEY = "runTempRoot";

/** Age past which a run root counts as abandoned by a killed run. No live run lasts this long, so a concurrent run's root is never swept. */
export const STALE_RUN_TEMP_ROOT_AGE_MS = 24 * 60 * 60 * 1000;

/** Every env var `os.tmpdir()` reads: `TEMP` and `TMP` on Windows, `TMPDIR` on POSIX. */
export const TEMP_DIR_ENV_KEYS = ["TMP", "TEMP", "TMPDIR"];

/** Retries while a detached child process still holds a file inside the root, which blocks deletion on Windows. */
export const RUN_TEMP_ROOT_REMOVE_RETRIES = 5;
