import { join } from "path";
import { ServiceLoopReportKind, WatchFindingCode, WatchFindingSeverity, WatchServiceInstallOutcome } from "./types.js";

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
 * How long a slot may sit with no loop process before it counts as dead. A loop
 * exits on every report and the owning session re-arms it once it has handled
 * the report, so a short gap is the normal handoff, not a death.
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

/**
 * How long a restart waits for a stopped session's process to exit. `claude
 * stop` returns before it does, and resuming a session that is still running
 * starts a copy of it under a new id instead of continuing it.
 */
export const SESSION_EXIT_WAIT_MS = 20_000;

/** Interval between listings while a restart waits for the exit. */
export const SESSION_EXIT_POLL_MS = 1_000;

/** Cap on owner-session resumes per tick, for the same reason. */
export const MAX_RESUMES_PER_TICK = 2;

/** Wait after a resume attempt before the same owner is tried again. */
export const RECOVERY_COOLDOWN_MS = 30 * 60_000;

/** Resume attempts per owner inside `RECOVERY_ATTEMPT_WINDOW_MS` before recovery stops and only alerts. */
export const RECOVERY_MAX_ATTEMPTS = 3;

/** The window `RECOVERY_MAX_ATTEMPTS` counts over. */
export const RECOVERY_ATTEMPT_WINDOW_MS = 24 * 60 * 60_000;

/**
 * The command an owner session is woken with, always naming one slot and PR:
 * a wake hands the session its own PR's report and nothing else.
 */
export const PR_FOLLOWUP_COMMAND = "/muggle:muggle-pr-followup";

/** Where a loop the watch started writes its output, inside its slot. */
export const SERVICE_LOOP_OUTPUT_FILE = "watch-service.out";

/** A service loop's output once its report reached the owner session, kept for diagnosis. */
export const SERVICE_LOOP_DELIVERED_FILE = "watch-service.delivered.out";

/** The slot file naming who hears the leased loop's exit; absent when the session that armed it does. */
export const WATCH_LISTENER_FILE = "watch-listener";

/** The listener a loop the watch started records, passed to it as `MUGGLE_PR_WATCH_LISTENER`. */
export const SERVICE_WATCH_LISTENER = "muggle-watch";

/** The arm script, relative to the package root. */
export const PR_WATCH_ARM_SCRIPT_RELATIVE_PATH = join("plugin", "scripts", "pr-watch-arm.sh");

/** Cap on loops the watch starts per tick, so a mass die-off is restored over a few ticks rather than in one burst of `gh` calls. */
export const MAX_SERVICE_ARMS_PER_TICK = 5;

/** The first word of each line a loop ends on, by the reason it names. */
export const SERVICE_LOOP_REPORT_PREFIXES: ReadonlyArray<{ prefix: string; kind: ServiceLoopReportKind }> = [
  { prefix: "TERMINAL ", kind: ServiceLoopReportKind.Terminal },
  { prefix: "EVENT ", kind: ServiceLoopReportKind.Event },
  { prefix: "WATCH-FAIL ", kind: ServiceLoopReportKind.Failed },
  { prefix: "ARM-FAIL ", kind: ServiceLoopReportKind.Failed },
  { prefix: "EXPIRED ", kind: ServiceLoopReportKind.Expired },
  { prefix: "ROLLOVER ", kind: ServiceLoopReportKind.Expired },
];

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

/** The slot's append-only log of what its watcher and cycles did. */
export const FOLLOWUP_LOG_FILE = "followup.log";

/** The word a watcher's `followup.log` line carries when it hands work to the owner. */
export const FOLLOWUP_LOG_ESCALATED_WORD = "escalated";

/** Longest watcher note an awaiting-owner finding quotes before cutting it short. */
export const OWNER_ESCALATION_NOTE_MAX_CHARS = 200;

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
  [WatchFindingCode.AwaitingOwner]: WatchFindingSeverity.Alert,
  [WatchFindingCode.BaseConflict]: WatchFindingSeverity.Alert,
  [WatchFindingCode.BehindBase]: WatchFindingSeverity.Warning,
  [WatchFindingCode.ReviewThreadsUnresolved]: WatchFindingSeverity.Warning,
  [WatchFindingCode.PrStatusUnavailable]: WatchFindingSeverity.Warning,
  [WatchFindingCode.OrphanedMcpServer]: WatchFindingSeverity.Warning,
  [WatchFindingCode.SlotTerminalUnfinalized]: WatchFindingSeverity.Notice,
  [WatchFindingCode.OwnerWakePending]: WatchFindingSeverity.Alert,
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

/** Claude's global config, which caches the account's usage: in the home dir, or in `CLAUDE_CONFIG_DIR` when that is set. */
export const CLAUDE_GLOBAL_CONFIG_FILE_NAME = ".claude.json";

/** Claude's user settings file, under its config dir; `remoteControlAtStartup` lives here. */
export const CLAUDE_SETTINGS_FILE_NAME = "settings.json";

/** Where Claude keeps its claude.ai credentials on Windows and Linux, under its config dir; a login rewrites it. */
export const CLAUDE_CREDENTIALS_FILE_NAME = ".credentials.json";

/** Restarts per session to put it back on Remote Control inside `REMOTE_CONTROL_RESTART_WINDOW_MS`, so a link that never comes back cannot loop. */
export const REMOTE_CONTROL_MAX_RESTARTS = 2;

/** The window `REMOTE_CONTROL_MAX_RESTARTS` counts over. */
export const REMOTE_CONTROL_RESTART_WINDOW_MS = 24 * 60 * 60_000;

/** Wait after a Remote Control restart before the same session is tried again; each restart opens a new Remote Control session. */
export const REMOTE_CONTROL_RESTART_COOLDOWN_MS = 30 * 60_000;

/** Characters of a session's name `muggle watch status` shows in its Remote Control and usage-limit rows. */
export const REMOTE_CONTROL_NAME_COLUMN_WIDTH = 32;

/** The `apiError` Claude records on the synthetic reply that ends a turn at a usage limit. */
export const USAGE_LIMIT_API_ERROR = "usage_limit_reached";

/** Bytes read from the end of a transcript to find the turn it ended on; a limit notice is a few hundred. */
export const TRANSCRIPT_TAIL_BYTES = 256 * 1024;

/** The one prompt a session cut off by a usage limit is continued with. */
export const LIMIT_RESUME_PROMPT = "The usage limit that stopped your last turn has reset. Continue where you left off.";

/** Continues per session inside `LIMIT_RESUME_WINDOW_MS`, failed ones included, so a session that cannot be continued is not retried every tick. */
export const LIMIT_RESUME_MAX_ATTEMPTS = 2;

/** The window `LIMIT_RESUME_MAX_ATTEMPTS` counts over. */
export const LIMIT_RESUME_WINDOW_MS = 24 * 60 * 60_000;

/** A limit stop older than this is left alone: the weekly window plus a day, past which the work is someone's to pick up by hand. */
export const LIMIT_STOP_MAX_AGE_MS = 8 * 24 * 60 * 60_000;

/** The utilization percent at which a cached usage window has run out. */
export const USAGE_WINDOW_EXHAUSTED_PERCENT = 100;

/** The plugin install scope a reload fan-out follows; project-scoped installs touch one checkout only. */
export const RELOAD_PLUGIN_SCOPE = "user";

/** The key Claude's install record files this plugin under: marketplace entry `muggleai` in marketplace `muggle-works`. */
export const MUGGLE_PLUGIN_ID = "muggleai@muggle-works";

/** File name prefix Codex gives every session rollout. */
export const CODEX_ROLLOUT_PREFIX = "rollout-";

/** The postinstall log in the muggle data dir, one block per install. */
export const MUGGLE_INSTALL_LOG_FILE = "postinstall.log";

/** The line that opens one install's block in `postinstall.log`, capturing its ISO timestamp. */
export const INSTALL_STARTED_PATTERN = /^Postinstall started at (\S+)/;

/** The line a global install writes once Claude's marketplace points at it, capturing the version. */
export const INSTALL_LOADED_VERSION_PATTERN = /Claude plugin sync updated: loading (\S+?) from/;

/** Name of the throwaway session that probes whether a workspace allows background restarts. */
export const TRUST_PROBE_SESSION_NAME = "muggle-watch-trust-probe";

/** The probe session's prompt; it is stopped and removed before it gets far. */
export const TRUST_PROBE_PROMPT = "Reply with OK. Do not use any tools.";

/** The refusal Claude prints when a workspace has not been trusted. */
export const WORKSPACE_UNTRUSTED_PATTERN = /workspace not trusted/i;

/** The id `claude --bg` prints for the session it started. */
export const BACKGROUNDED_SESSION_ID_PATTERN = /backgrounded · (\w+)/;

/** Who closed out a slot, as its `followup.log` line records it. */
export const SLOT_CLOSED_OUT_BY = "muggle-watch";

/** The Windows installer for the watch's scheduled task, relative to the package root. */
export const WATCH_INSTALLER_RELATIVE_PATH = "scripts/muggle-watch/install-muggle-watch.ps1";

/** The scheduled task the installer registers. */
export const WATCH_SCHEDULED_TASK_NAME = "MuggleWatch";

/** How long the installer may run; it waits up to two minutes for the first tick. */
export const WATCH_INSTALLER_TIMEOUT_MS = 180_000;

/** Install outcomes `muggle init` keeps quiet about: nothing was asked for, so nothing happened. */
export const WATCH_SERVICE_QUIET_OUTCOMES: ReadonlySet<WatchServiceInstallOutcome> = new Set([
  WatchServiceInstallOutcome.NotRequested,
  WatchServiceInstallOutcome.TurnedOff,
]);

/** The POSIX launcher every macOS and Linux scheduler runs, relative to the package root. */
export const WATCH_TICK_LAUNCHER_RELATIVE_PATH = "scripts/muggle-watch/muggle-watch-tick.sh";

/** File names staged in the watch dir's `bin`: the launcher and the PATH it restores. */
export const WATCH_TICK_LAUNCHER_FILE = "muggle-watch-tick.sh";
export const WATCH_ENV_FILE = "watch-env.sh";
export const WATCH_BIN_DIR_NAME = "bin";

/** The muggle entry point of a global install, relative to `npm root -g`. */
export const GLOBAL_MUGGLE_ENTRY_RELATIVE_PATH = "@muggleai/works/bin/muggle.js";

/** The muggle entry point relative to this package's root, when no global install is found. */
export const PACKAGE_MUGGLE_ENTRY_RELATIVE_PATH = "bin/muggle.js";

/** How often every scheduler runs a tick. */
export const WATCH_TICK_INTERVAL_SECONDS = 120;

/** The launchd agent's label, and the plist file named after it. */
export const WATCH_LAUNCHD_LABEL = "ai.muggle.watch";

/** The systemd user units' shared name: `muggle-watch.service` and `muggle-watch.timer`. */
export const WATCH_SYSTEMD_UNIT_NAME = "muggle-watch";

/** Trailing comment that marks the watch's line in a crontab, so a re-install replaces only it. */
export const WATCH_CRON_MARKER = "# muggle-watch";
