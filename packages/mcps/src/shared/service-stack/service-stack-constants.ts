/** Tunables for the local service-stack ledger at {@link ./service-stack.ts}. */

import { StackLeaseEndReason } from "./service-stack-types.js";

/** Directory under the Muggle home holding the ledger's committed generations. */
export const STACK_LEDGER_DIR_NAME = "service-stack";

/** Directory under the Muggle home where prepare records the services it started, one file per checkout. */
export const PREPARE_TRACKING_DIR_SEGMENTS = ["prepare", "running"] as const;

/**
 * A granted lease that has not run yet ends this long after the grant unless
 * every port it claimed is served by a service prepare tracks at the claimed
 * code: the time prepare has to install and start them. Every question is
 * asked before the claim, so nothing in this window waits on a person.
 */
export const SERVE_WINDOW_MS = 8 * 60_000;

/**
 * Once every claimed port serves the claimed code, a lease that has not run
 * yet ends this long after: time for a dev server to compile and the first run
 * to start, too short to hold the ports while the session waits on anything else.
 */
export const FIRST_RUN_WINDOW_MS = 4 * 60_000;

/**
 * How long the ledger remembers a lease it ended without a release, so that
 * checkout's next run is refused instead of sent at services that were stopped.
 */
export const ENDED_LEASE_MEMORY_MS = 30 * 60_000;

/**
 * A lease with no run in flight ends this long after its last run ended: its
 * session has stopped testing. Long enough for the turn between consecutive
 * runs of one batch, short enough that a session gone to rebase or edit code
 * gives the stack up.
 */
export const IDLE_RELEASE_MS = 2 * 60_000;

/** A run in flight for longer than this is taken as lost, and no longer keeps its lease. */
export const MAX_RUN_MS = 2 * 60 * 60_000;

/**
 * A lease whose holder processes have all exited ends once it has also gone
 * this long untouched. The short wait rides out an MCP server restart, whose
 * replacement records its own pid on the next run.
 */
export const DEAD_HOLDER_GRACE_MS = 60_000;

/** How long after a run ends its MCP server ends the lease, if no other run started meanwhile. */
export const IDLE_REAP_DELAY_MS = IDLE_RELEASE_MS + 5_000;

/** Longest the platform tool stopping a service may take. */
export const SERVICE_STOP_COMMAND_TIMEOUT_MS = 15_000;

/**
 * Set to `off` by the test config. Ending a lease stops whatever listens on its
 * ports, and the suites claim real port numbers — so the suite disables stops
 * wholesale rather than trusting every test to inject a fake.
 */
export const SERVICE_STOPS_ENV = "MUGGLE_STACK_SERVICE_STOPS";

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

/** Longest listener command line a mismatch description quotes before eliding the rest. */
export const LISTENER_COMMAND_MAX_CHARS = 120;

/** Why the ledger ended a lease, as a check or a refused run states it. */
export const LEASE_END_REASON_TEXT: Readonly<Record<StackLeaseEndReason, string>> = {
  [StackLeaseEndReason.NeverServed]: `its ports did not serve the claimed code within ${SERVE_WINDOW_MS / 60_000} minutes of the grant`,
  [StackLeaseEndReason.NoRunAfterServed]: `no run started within ${FIRST_RUN_WINDOW_MS / 60_000} minutes of its services coming up`,
  [StackLeaseEndReason.Idle]: `no run started within ${IDLE_RELEASE_MS / 60_000} minutes of the last one`,
  [StackLeaseEndReason.HolderExited]: "every MCP server that ran under it exited",
};

/** Default port of a URL with no explicit port, by scheme. */
export const DEFAULT_PORT_BY_PROTOCOL: Readonly<Record<string, number>> = { "http:": 80, "https:": 443 };
