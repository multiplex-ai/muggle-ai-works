/** Rebase cycles the watch dispatches for one `<head>..<base-tip>` key before falling through to CI. */
export const MAX_REBASE_ATTEMPTS_PER_KEY = 2;

/** Fix-ci cycles the watch dispatches for one head before leaving it to the escalation fix-ci records. */
export const MAX_CI_FIX_ATTEMPTS_PER_HEAD = 3;

/** Joins the head and base tip of a rebase key. A key without it is a legacy bare SHA, which every reader ignores. */
export const REBASE_KEY_SEPARATOR = "..";

/** Where muggle-do session slots live, under the home directory. */
export const MUGGLE_DO_SESSIONS_PATH_SEGMENTS = [".muggle-ai", "muggle-do", "sessions"] as const;

/** Slot files, named as `muggle-pr-followup/state-schemas.md` names them. */
export const PRS_FILE_NAME = "prs.json";
export const OWNER_FILE_NAME = "owner.json";
export const LAST_SEEN_FILE_NAME = "last_seen.json";
export const RESULT_FILE_NAME = "result.md";

/** The slot file the watch loop and the arm step rewrite with the work they last saw due; empty when nothing is. */
export const WATCH_DUE_FILE_NAME = "watch-due.env";

/** `watch-due.env` keys, spelled as `pr-watch-due.sh` writes them. */
export const WATCH_DUE_HEAD_FIELD = "HEAD";
export const WATCH_DUE_REBASE_FIELD = "REBASE_DUE";
export const WATCH_DUE_CI_RED_FIELD = "CI_RED_HEAD";
export const WATCH_DUE_FEEDBACK_REVIEWS_FIELD = "FEEDBACK_REVIEWS";
export const WATCH_DUE_FEEDBACK_CONVERSATION_FIELD = "FEEDBACK_CONVERSATION";
export const WATCH_DUE_FEEDBACK_THREADS_FIELD = "FEEDBACK_THREADS";

/** The slot file the arm seeds and the session advances past the feedback it handled. */
export const WATCH_WATERMARK_FILE_NAME = "watch-watermark.env";

/** The `watch-watermark.env` key holding the highest thread-comment id already handled. */
export const WATCH_WATERMARK_COMMENT_FIELD = "COM";

/** Where a loop the muggle watch service started writes its output, inside its slot. */
export const SERVICE_LOOP_OUTPUT_FILE = "watch-service.out";

/** A service loop's output once its report reached the owner session, kept for diagnosis. */
export const SERVICE_LOOP_DELIVERED_FILE = "watch-service.delivered.out";

/**
 * Service loop reports set aside, undelivered, so a fresh loop can watch the PR while they wait for the owner. Each
 * report is appended; the owner's wake, or a loop the owner arms, retires the file.
 */
export const SERVICE_LOOP_QUEUED_WAKE_FILE = "watch-service.queued.out";

/** The first word of a loop line reporting new activity on the PR. */
export const SERVICE_LOOP_EVENT_LINE_PREFIX = "EVENT ";

/** The first word of a loop line reporting the PR merged or closed. */
export const SERVICE_LOOP_TERMINAL_LINE_PREFIX = "TERMINAL ";

/** The loop lines its owner session must be woken for. */
export const OWNER_WAKE_LINE_PREFIXES = [SERVICE_LOOP_TERMINAL_LINE_PREFIX, SERVICE_LOOP_EVENT_LINE_PREFIX] as const;

/** One `KEY=value` or `KEY="value"` line of a slot's env-style files. */
export const ENV_FILE_LINE = /^([A-Z_]+)="?([^"]*)"?$/;

/** Where the user's muggle preferences live, under the home directory. */
export const USER_PREFERENCES_PATH_SEGMENTS = [".muggle-ai", "preferences.json"] as const;

/** Where the shipped preference defaults live, under the plugin root. */
export const PREFERENCE_DEFAULTS_PATH_SEGMENTS = ["config", "preference-defaults.json"] as const;

export const AUTO_REBASE_PREFERENCE_KEY = "autoRebase";
export const MAX_CATCH_UP_REBASES_PREFERENCE_KEY = "maxCatchUpRebases";
export const WATCHER_LIFETIME_PREFERENCE_KEY = "watcherLifetime";

/** Each `watcherLifetime` value as the seconds `MUGGLE_PR_WATCH_MAX_LIFETIME` takes; 0 is unbounded. */
export const WATCHER_LIFETIME_SECONDS: Readonly<Record<string, number>> = { "1d": 86_400, "7d": 604_800, never: 0 };

/** The preference value that makes an action binding rather than offered. */
export const ALWAYS_PREFERENCE_VALUE = "always";

/** The configuration value that lifts a cap entirely. */
export const UNBOUNDED_PREFERENCE_VALUE = "never";

/** A cap spelled as a positive integer, the only other form `maxCatchUpRebases` takes. */
export const POSITIVE_INTEGER = /^[1-9]\d*$/;

/** Lines carrying a value that spans them could forge another key in a line-based watermark, so such a value is dropped. */
export const LINE_BREAK = /[\r\n]/;

/** `pr-watch-verdict.mjs` flags, without their leading dashes. */
export const PR_KEY_FLAG = "pr-key";
export const HEAD_FLAG = "head";
export const REBASE_KEY_FLAG = "rebase-key";
export const REBASE_DUE_FLAG = "rebase-due";
export const CI_FLAG = "ci";
export const BODY_REVIEWS_FLAG = "body-reviews";
export const CONVERSATION_COMMENTS_FLAG = "conversation-comments";
export const UNANSWERED_THREADS_FLAG = "unanswered-threads";

/** Separates the entries of the state projection's id lists. */
export const STATE_LIST_SEPARATOR = ",";

/** Joins an unanswered thread's newest comment id to its owning review id in the state projection. */
export const THREAD_COMMENT_REVIEW_SEPARATOR = ":";

/** The `--rebase-due` spelling for a branch behind or conflicting with its base. */
export const REBASE_DUE_YES = "yes";

/** Exit status for a malformed invocation: a broken install or a mistyped command, never a verdict. */
export const USAGE_EXIT_CODE = 2;

export const PR_WATCH_VERDICT_USAGE =
  "usage: pr-watch-verdict.mjs arm-floors --pr-key <owner/repo#n> --head <sha> --rebase-key <head..base-tip> " +
  "[--body-reviews <ids>] [--conversation-comments <ids>] [--unanswered-threads <comment:review,...>] < last_seen.json\n" +
  "       pr-watch-verdict.mjs tick --pr-key <owner/repo#n> --head <sha> --rebase-key <head..base-tip> " +
  "--rebase-due <yes|no> --ci <red|pending|green> < last_seen.json";
