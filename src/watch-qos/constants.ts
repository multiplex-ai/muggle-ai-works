/** Subdirectory of the muggle data dir that holds the watch quality-of-service ledger. */
export const WATCH_QOS_DIR_NAME = "telemetry";

/** The append-only ledger every detector writes to. */
export const WATCH_QOS_LEDGER_FILE_NAME = "watch-qos.jsonl";

/** The ledger's previous generation, kept so a fresh ledger still deduplicates against it. */
export const WATCH_QOS_ROTATED_LEDGER_FILE_NAME = "watch-qos.1.jsonl";

/** The upload cursor: the byte offset of the live ledger already handed to telemetry. */
export const WATCH_QOS_CURSOR_FILE_NAME = "watch-qos.cursor.json";

/** A fully uploaded ledger past this size is rotated, so the dedup read a hook does stays small. */
export const WATCH_QOS_LEDGER_ROTATE_BYTES = 256 * 1024;

/**
 * How long a red head may sit with no fix attempt, escalation or repair wait before it counts as late. The loop polls
 * every minute; this separates a miss from normal latency without flagging a busy session.
 */
export const CI_RED_RESPONSE_WINDOW_MS = 15 * 60_000;

/** Hex characters kept of each salted SHA-256 identity hash. */
export const WATCH_QOS_IDENTITY_HEX_LENGTH = 32;

/** Joins the salt and the identity before hashing, so `ab` + `c` never hashes like `a` + `bc`. */
export const WATCH_QOS_IDENTITY_SEPARATOR = "\n";

/** Joins the fields of a ledger dedup key. */
export const WATCH_QOS_DEDUP_KEY_SEPARATOR = "|";

/** Env var that switches ledger writes off; the test runs set it so fixtures never write to the real ledger. */
export const WATCH_QOS_LEDGER_ENV_VAR = "MUGGLE_WATCH_QOS_LEDGER";

/** The value of `WATCH_QOS_LEDGER_ENV_VAR` that switches ledger writes off. */
export const WATCH_QOS_LEDGER_DISABLED_VALUE = "off";

/**
 * How long `muggle watch tick` stays up after handing records to telemetry. The telemetry client batches in the
 * background and exposes no flush, so a process that exits at once drops what it just tracked.
 */
export const WATCH_QOS_UPLOAD_SETTLE_MS = 10_000;

/** Flags the loop's record entry takes, as `--<name> <value>`. */
export const WATCH_QOS_RECORD_FLAGS = {
  signal: "--signal",
  detector: "--detector",
  repo: "--repo",
  pr: "--pr",
  head: "--head",
  occurrence: "--occurrence",
} as const;
