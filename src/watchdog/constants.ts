export const WATCHDOG_SCAN_INTERVAL_SECONDS_DEFAULT = 300;

// Liveness window mirrors reconcile.md Step 3.6: a live 1m recovery cron logs
// many times inside it, and a live monitor touches its heartbeat every ~60s.
export const WATCHER_LIVENESS_STALE_AFTER_MS = 15 * 60 * 1000;

// Just under one default scan interval, so a signal first seen at scan N is
// confirmed (and spawned) at scan N+1 — never inside the same scan.
export const PENDING_SIGNAL_CONFIRM_AFTER_MS = 4 * 60 * 1000;

// How long an unconfirmed spawn (no new followup.log line) waits before the
// same signature is retried. This is the limit-reset recovery path: while the
// usage limit holds, every headless spawn dies silently and this window paces
// the retries until one lands.
export const SPAWN_RETRY_AFTER_MS = 10 * 60 * 1000;

// A dispatch line newer than the last cycle-outcome line marks a /muggle-do
// cycle that owns the PR; past this grace the cycle is presumed crashed.
export const CYCLE_IN_PROGRESS_GRACE_MS = 90 * 60 * 1000;

export const MAX_TICK_SPAWNS_PER_SCAN = 3;

export const LOOP_REPLY_MARKER = "<!-- muggle-do:bot -->";

export const WATCH_HEARTBEAT_FILENAME = "watch-heartbeat";
export const WATCHDOG_SLOT_STATE_FILENAME = "watchdog.json";
export const WATCHDOG_LOCK_FILENAME = "watchdog.lock";
export const WATCHDOG_HEARTBEAT_FILENAME = "watchdog-heartbeat";
export const WATCHDOG_LOG_FILENAME = "watchdog.log";
