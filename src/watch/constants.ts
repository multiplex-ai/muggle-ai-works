import { WatchFindingCode, WatchFindingSeverity } from "./types.js";

/** Subdirectory of the muggle data dir that holds the watch ledger. */
export const WATCH_DIR_NAME = "watch";

/** The last tick's full snapshot. */
export const WATCH_STATUS_FILE = "status.json";

/** Ledger state carried between ticks. */
export const WATCH_STATE_FILE = "state.json";

/** Append-only raise/clear/respawn history. */
export const WATCH_EVENTS_FILE = "events.jsonl";

/** `events.jsonl` is rotated to `events.1.jsonl` once it grows past this. */
export const WATCH_EVENTS_ROTATE_BYTES = 5 * 1024 * 1024;

/**
 * The longest a Monitor keeps reading its command's stdout. A watch loop older
 * than this has outlived the pipe it reports into, so its events reach no
 * session even though it still polls and heartbeats.
 */
export const MONITOR_STDOUT_CAP_MS = 30 * 60_000;

/**
 * How long a slot may sit with no loop process before it counts as dead. A
 * rollover exits the loop and the owning session re-arms it on its next turn
 * boundary, so a short gap is the normal handoff, not a death.
 */
export const WATCHER_REARM_GRACE_MS = 5 * 60_000;

/** A Codex rollout written within this window marks its session active. */
export const CODEX_ACTIVE_WINDOW_MS = 10 * 60_000;

/**
 * Newest Codex day dirs (`sessions/YYYY/MM/DD`) scanned. A rollout stays in the
 * dir of the day its session started, so a long-running session's file can sit
 * several days back.
 */
export const CODEX_ROLLOUT_DAY_DIRS_SCANNED = 7;

/** Cap on `claude respawn` calls per tick, so a plugin update never restarts every session at once. */
export const MAX_RESPAWNS_PER_TICK = 3;

/** Cap on owner-session resumes per tick, for the same reason. */
export const MAX_RESUMES_PER_TICK = 2;

/** Wait after a resume attempt before the same owner is tried again. */
export const RECOVERY_COOLDOWN_MS = 30 * 60_000;

/** Resume attempts per owner inside `RECOVERY_ATTEMPT_WINDOW_MS` before recovery stops and only alerts. */
export const RECOVERY_MAX_ATTEMPTS = 3;

/** The window `RECOVERY_MAX_ATTEMPTS` counts over. */
export const RECOVERY_ATTEMPT_WINDOW_MS = 24 * 60 * 60_000;

/**
 * The prompt a resumed owner session starts on. Reconcile re-arms only the
 * slots that session armed itself, which is what keeps recovery inside the
 * context that knows each PR.
 */
export const RECOVERY_RESUME_PROMPT = "/muggle:muggle-pr-followup reconcile";

/** Open PRs per GraphQL request. */
export const PR_STATUS_BATCH_SIZE = 25;

/**
 * How long a PR GitHub reported merged or closed goes unqueried. Each PR costs
 * the batch about half a second, and unfinalized slots of merged PRs pile up;
 * the recheck is what still catches a closed PR that was reopened.
 */
export const TERMINAL_PR_RECHECK_MS = 6 * 60 * 60_000;

/** Longest a spawned helper (`claude`, `gh`, `powershell`, `ps`) may run. */
export const WATCH_COMMAND_TIMEOUT_MS = 30_000;

/** Stdout a spawned helper may produce; a full Windows process table runs to a few hundred KB. */
export const WATCH_COMMAND_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** Bytes read from the head of a transcript or rollout to find its session metadata. */
export const SESSION_FILE_HEAD_BYTES = 64 * 1024;

/** Lock that serializes a scheduled tick with a manual `reload-plugins` run. */
export const WATCH_LOCK_FILE = "watch.lock";

/** How long a run waits for the lock before giving up on this pass. */
export const WATCH_LOCK_WAIT_MS = 60_000;

/** Path of the PR-watch slot dirs, relative to the muggle data dir. */
export const PR_WATCH_SLOTS_RELATIVE_PATH = ["muggle-do", "sessions"] as const;

/** The owner's global kill switch for every PR watch; it sits beside the slot dirs. */
export const PR_POLLING_DISABLED_FILE = "polling.disabled";

/** The slot file that opts a slot into out-of-session recovery. */
export const WATCH_REGISTRATION_FILE = "watch-registration.json";

/** Who wrote a registration made through the CLI. */
export const WATCH_REGISTRATION_SOURCE_CLI = "muggle-watch-cli";

/** Ancestor hops walked when deciding whether a process still belongs to an agent. */
export const MAX_ANCESTOR_HOPS = 8;

/** Title of every desktop notification the watch raises. */
export const WATCH_NOTIFICATION_TITLE = "Muggle Watch";

/** Findings listed in one notification before the rest collapse into a count. */
export const WATCH_NOTIFICATION_MAX_LINES = 3;

/** Every finding code's severity. Only alerts raise a notification. */
export const WATCH_FINDING_SEVERITY: Record<WatchFindingCode, WatchFindingSeverity> = {
  [WatchFindingCode.WatcherDead]: WatchFindingSeverity.Alert,
  [WatchFindingCode.WatcherDeaf]: WatchFindingSeverity.Alert,
  [WatchFindingCode.CiFailing]: WatchFindingSeverity.Alert,
  [WatchFindingCode.BaseConflict]: WatchFindingSeverity.Alert,
  [WatchFindingCode.BehindBase]: WatchFindingSeverity.Warning,
  [WatchFindingCode.ReviewThreadsUnresolved]: WatchFindingSeverity.Warning,
  [WatchFindingCode.PrStatusUnavailable]: WatchFindingSeverity.Warning,
  [WatchFindingCode.OrphanedMcpServer]: WatchFindingSeverity.Warning,
  [WatchFindingCode.SlotTerminalUnfinalized]: WatchFindingSeverity.Notice,
};

/** Executable names (lower-cased, `.exe` stripped) of a Claude Code process. */
export const CLAUDE_EXECUTABLE_PATTERN = /^claude$/;

/** Executable names of a Codex CLI process, including its platform-suffixed binaries. */
export const CODEX_EXECUTABLE_PATTERN = /^codex(?:-[\w-]+)?$/;

/** Executables whose command lines the process lister keeps; every other row carries only its pids. */
export const COMMAND_LINE_EXECUTABLE_PATTERN = /^(?:claude|codex(?:-[\w-]+)?|node|bash)$/;

/** A muggle MCP server, launched either from the global install or through npx. */
export const MUGGLE_MCP_SERVER_PATTERN = /@muggleai[\\/]works\b.*\bserve\b/;

/** A PR watch loop, capturing the `--slot` path whether or not it is quoted. */
export const PR_WATCH_LOOP_PATTERN = /pr-watch-loop\.sh\b.*?--slot\s+(?:"([^"]+)"|(\S+))/;

/** Claude's session registry, under the Claude config dir. */
export const CLAUDE_SESSION_REGISTRY_DIR_NAME = "sessions";

/** Claude's per-project transcript dirs, under the Claude config dir. */
export const CLAUDE_PROJECTS_DIR_NAME = "projects";

/** Claude's record of installed plugins, relative to the Claude config dir. */
export const CLAUDE_INSTALLED_PLUGINS_RELATIVE_PATH = ["plugins", "installed_plugins.json"] as const;

/** The plugin install scope a reload fan-out follows; project-scoped installs touch one checkout only. */
export const RELOAD_PLUGIN_SCOPE = "user";

/** File name prefix Codex gives every session rollout. */
export const CODEX_ROLLOUT_PREFIX = "rollout-";
