/** The ledger file's name inside a muggle-do slot. */
export const LEDGER_FILE_NAME = "comment-ledger.json";

/** Current on-disk ledger version. */
export const LEDGER_VERSION = 1;

/** How long a ledger write waits for the lock. Rounds already run for minutes and contention here is near-zero, so waiting costs nothing while a dropped write would be a lost obligation. */
export const LEDGER_LOCK_WAIT_MS = 30_000;

/** How many times a ledger commit re-reads and reapplies before giving up. */
export const LEDGER_COMMIT_ATTEMPTS = 5;

/** Backstop expiry for a claim made on another machine, whose holder cannot be probed. Far beyond any plausible round, so it bounds a wedge without ever racing a live worker. */
export const FOREIGN_CLAIM_EXPIRY_MS = 6 * 60 * 60 * 1000;
