/** Tunables for the local service-stack ledger at {@link ./service-stack.ts}. */

/** Directory under the Muggle home holding the ledger's committed generations. */
export const STACK_LEDGER_DIR_NAME = "service-stack";

/** Directory under the Muggle home where prepare records the services it started, one file per checkout. */
export const PREPARE_TRACKING_DIR_SEGMENTS = ["prepare", "running"] as const;

/**
 * A lease nobody has renewed for this long is over: its holder finished
 * without releasing, or went away. Claims, checks and every local run renew
 * it, so an agent mid-batch never comes close.
 */
export const LEASE_TTL_MS = 20 * 60_000;

/**
 * A lease whose holder processes have all exited ends once it has also gone
 * this long without renewal, instead of waiting out {@link LEASE_TTL_MS}. The
 * short wait rides out an MCP server restart, whose replacement renews the
 * lease with its own pid on the next run.
 */
export const DEAD_HOLDER_GRACE_MS = 60_000;

/**
 * How long a waiting checkout keeps its turn after a port it waits on frees,
 * or after it last asked. A checkout that asked within this window, or whose
 * port freed within it, is served before anyone behind it who wants that port.
 */
export const CLAIM_GRACE_MS = 30_000;

/** A waiting checkout that has not asked for this long has stopped waiting; its place in line is dropped. */
export const TICKET_ABANDON_MS = 10 * 60_000;

/** Retry delay suggested to a claim turned away from a held port. */
export const SUGGESTED_RETRY_AFTER_MS = 30_000;

/** Retry delay suggested when the port is free but owed to a checkout ahead in line. */
export const OWED_RETRY_AFTER_MS = 5_000;

/** How often `--wait` re-asks while the stack is held. */
export const CLAIM_POLL_INTERVAL_MS = 1_000;

/** Process exit code of a claim turned away: a temporary condition, not an error (sysexits EX_TEMPFAIL). */
export const BUSY_EXIT_CODE = 75;

/** Default port of a URL with no explicit port, by scheme. */
export const DEFAULT_PORT_BY_PROTOCOL: Readonly<Record<string, number>> = { "http:": 80, "https:": 443 };
