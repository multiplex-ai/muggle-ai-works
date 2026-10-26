/** Tunables for the optimistic generation store at {@link ./generation-store.ts}. */

/** Prefix of a committed generation file: `generation-<zero-padded number>.json`. */
export const GENERATION_FILE_PREFIX = "generation-";

/** Suffix of a committed generation file. */
export const GENERATION_FILE_SUFFIX = ".json";

/** Digits a generation number is zero-padded to, so names sort lexically. */
export const GENERATION_DIGITS = 12;

/** Prefix of a not-yet-committed record, written in full before it is linked into place. */
export const PENDING_FILE_PREFIX = ".pending-";

/**
 * Committed generations kept behind the newest. A reader lists the directory
 * and then reads the newest file; keeping a tail means a reader that lagged a
 * few commits still finds the file it listed.
 */
export const GENERATIONS_KEPT = 8;

/** Attempts one read-decide-commit cycle makes when other writers keep winning the race. */
export const MAX_COMMIT_ATTEMPTS = 50;

/** Upper bound of the random pause between commit attempts, spreading out racing writers. */
export const COMMIT_RETRY_JITTER_MS = 20;
