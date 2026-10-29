import type { ProviderPrState } from "../guardrails/types.js";

/** The coding agent a work session belongs to. */
export enum WorkSessionAgent {
  Claude = "claude",
  Codex = "codex",
}

/** How Claude hosts a session: a daemon-managed background job or a terminal the user drives. */
export enum ClaudeSessionKind {
  Background = "background",
  Interactive = "interactive",
}

/** Whether a Claude session has a turn in flight, as `claude agents --json` reports it. */
export enum ClaudeTurnStatus {
  Busy = "busy",
  Idle = "idle",
  Waiting = "waiting",
}

/** A background job's overall state, as `claude agents --json` reports it. */
export enum ClaudeJobState {
  Working = "working",
  Blocked = "blocked",
  Done = "done",
}

/** One Claude or Codex session the watch can see. */
export interface WorkSession {
  agent: WorkSessionAgent;
  sessionId: string;
  /** The id `claude respawn` takes; Claude only. */
  shortId?: string;
  name?: string;
  cwd?: string;
  kind?: ClaudeSessionKind;
  turnStatus?: ClaudeTurnStatus;
  jobState?: ClaudeJobState;
  startedAtMs?: number;
  /** Codex only: when its rollout file was last written. */
  lastActivityAtMs?: number;
  /** Claude only: joined from the `~/.claude/sessions/<pid>.json` registry. */
  pid?: number;
  /** When the session last loaded its plugins: its process start or its newest muggle MCP server start. */
  loadedAtMs?: number;
  /** The muggle works build that was installed at `loadedAtMs`. */
  loadedVersion?: string;
}

/** One global muggle works install, as `postinstall.log` records it. */
export interface InstallRecord {
  atMs: number;
  version: string;
}

/** How many open PRs in one repo are heard, unheard, or unwatched. */
export interface RepoCoverage {
  repo: string;
  watched: number;
  deaf: number;
  dead: number;
}

/** The process kinds the watch reports on. */
export enum TrackedProcessKind {
  ClaudeCli = "claude-cli",
  CodexCli = "codex-cli",
  MuggleMcpServer = "muggle-mcp-server",
  PrWatchLoop = "pr-watch-loop",
}

/** One row of the OS process table, before classification. */
export interface ProcessTableEntry {
  pid: number;
  parentPid: number;
  /** Executable file name, lower-cased with any `.exe` stripped, e.g. `node` or `bash`. */
  executableName: string;
  /** Present only for executables whose command lines the lister keeps; empty otherwise. */
  commandLine: string;
  ageMs?: number;
}

/** A process the watch tracks, with what its kind needs to be judged. */
export interface TrackedProcess {
  pid: number;
  parentPid: number;
  kind: TrackedProcessKind;
  ageMs?: number;
  /**
   * True when an ancestor died before the chain reached a Claude or Codex process.
   * Undefined for PR watch loops: Git Bash's exec breaks their Windows parent
   * chain even while the loop is healthy, so ancestry says nothing about them.
   */
  isOrphaned?: boolean;
  /** PR watch loops only: the slot dir name its `--slot` argument names. */
  watchSlotSlug?: string;
}

/** An open PR a PR-watch slot is responsible for. */
export interface SlotPr {
  repo: string;
  number: number;
  url: string;
  headSha?: string;
}

/** What a PR-watch slot's files say, for a slot that still owes a watch. */
export interface WatchSlotRecord {
  slug: string;
  slotDir: string;
  ownerSessionId?: string;
  heartbeatMtimeMs?: number;
  /** Whether the slot opted into out-of-session recovery via `watch-registration.json`. */
  isRegistered: boolean;
  openPrs: SlotPr[];
  /** The slot's `last_seen.json` text, empty when it is missing. */
  lastSeenJson: string;
  /** The slot's `followup.log` lines, oldest first. */
  followupLogLines: string[];
}

/** Work a PR's watcher gave up on and handed to its owner session. */
export enum OwnerEscalationKind {
  Ci = "ci",
  Conflict = "conflict",
  Reviews = "reviews",
}

/** What a PR's watcher escalated to its owner session on the PR's live head. */
export interface OwnerEscalation {
  kinds: OwnerEscalationKind[];
  /** The watcher's latest escalation line for the PR in `followup.log`, without its timestamp. */
  note?: string;
}

/** The contents of a slot's `watch-registration.json`. */
export interface WatchSlotRegistration {
  registered_at: string;
  registered_by: string;
}

/** GitHub's `mergeable` verdict for a PR. */
export enum PrMergeable {
  Mergeable = "MERGEABLE",
  Conflicting = "CONFLICTING",
  Unknown = "UNKNOWN",
}

/** GitHub's `mergeStateStatus` for a PR. */
export enum PrMergeStateStatus {
  Behind = "BEHIND",
  Blocked = "BLOCKED",
  Clean = "CLEAN",
  Dirty = "DIRTY",
  Draft = "DRAFT",
  HasHooks = "HAS_HOOKS",
  Unknown = "UNKNOWN",
  Unstable = "UNSTABLE",
}

/** GitHub's combined check state for a commit. */
export enum CiRollupState {
  Success = "SUCCESS",
  Failure = "FAILURE",
  Error = "ERROR",
  Pending = "PENDING",
  Expected = "EXPECTED",
}

/** A PR's live state as GitHub reports it. */
export interface PrLiveStatus {
  url: string;
  state: ProviderPrState;
  headSha?: string;
  mergeable?: PrMergeable;
  mergeStateStatus?: PrMergeStateStatus;
  ciRollup?: CiRollupState;
  unresolvedThreadCount: number;
}

/** Whether a slot's watch loop is delivering events to a session. */
export enum WatcherLiveness {
  Polling = "polling",
  /** No loop right now, but the heartbeat is recent: a rollover hand-off in progress. */
  Rearming = "rearming",
  Deaf = "deaf",
  Dead = "dead",
}

/** One open PR's slot, judged: who watches it, whether that watch is heard, and what GitHub says. */
export interface WatchSlotAssessment {
  slug: string;
  slotDir: string;
  pr: SlotPr;
  isRegistered: boolean;
  watcher: WatcherLiveness;
  loopPid?: number;
  loopAgeMs?: number;
  heartbeatAgeMs?: number;
  ownerSessionId?: string;
  /** Undefined when the owner is unknown or the session listing could not be read. */
  isOwnerSessionActive?: boolean;
  live?: PrLiveStatus;
  /** Undefined when the watcher escalated nothing on the live head. */
  ownerEscalation?: OwnerEscalation;
}

/** How loudly a finding is surfaced: alerts notify, warnings and notices only land in the ledger. */
export enum WatchFindingSeverity {
  Alert = "alert",
  Warning = "warning",
  Notice = "notice",
}

/** Every condition the watch reports. */
export enum WatchFindingCode {
  WatcherDead = "WATCHER_DEAD",
  WatcherDeaf = "WATCHER_DEAF",
  CiFailing = "CI_FAILING",
  AwaitingOwner = "AWAITING_OWNER",
  BaseConflict = "BASE_CONFLICT",
  BehindBase = "BEHIND_BASE",
  ReviewThreadsUnresolved = "REVIEW_THREADS_UNRESOLVED",
  PrStatusUnavailable = "PR_STATUS_UNAVAILABLE",
  OrphanedMcpServer = "ORPHANED_MCP_SERVER",
  SlotTerminalUnfinalized = "SLOT_TERMINAL_UNFINALIZED",
}

/** One condition the watch found this tick. `key` is stable for as long as the condition is the same one. */
export interface WatchFinding {
  key: string;
  code: WatchFindingCode;
  severity: WatchFindingSeverity;
  /** What the finding is about, e.g. `multiplex-ai/muggle-ai-works#547` or `pid 4120`. */
  subject: string;
  message: string;
}

/** Where one owner session's watcher recovery stands this tick. */
export enum WatcherRecoveryOutcome {
  /** Planned and not yet run; the executor turns it into one of the outcomes below. */
  ResumeDue = "resume-due",
  Resumed = "resumed",
  ResumeFailed = "resume-failed",
  CoolingDown = "cooling-down",
  AttemptsExhausted = "attempts-exhausted",
  DeferredByTickCap = "deferred-by-tick-cap",
  TranscriptMissing = "transcript-missing",
  /** The owner is still running and Claude would not resume it in its workspace, so it was left running. */
  RestartRefused = "restart-refused",
  /** The owner is still running at the usage limit and retries its own turn once the limit resets; a resume could only start a copy. */
  AwaitingUsageLimitReset = "awaiting-usage-limit-reset",
}

/** One owner session whose registered slots have dead watchers, and what the watch did about it. */
export interface WatcherRecovery {
  ownerSessionId: string;
  slotSlugs: string[];
  outcome: WatcherRecoveryOutcome;
  cwd?: string;
  /** Set when the owner is still running, idle between turns: the id `claude stop` takes before the resume. */
  ownerShortId?: string;
  /** Set when the owner's job continued under a newer session id than `ownerSessionId`: the id its exit is awaited by. */
  ownerRunningSessionId?: string;
}

/** A session to resume on reconcile, from the project dir its transcript names. */
export interface ReconcileResumeTarget {
  sessionId: string;
  cwd: string;
  /** Set when the session is still running: the id `claude stop` takes before the resume. */
  runningShortId?: string;
  /** Set when the running job lists under a newer session id than `sessionId`: the id its exit is awaited by. */
  runningSessionId?: string;
}

/** The edges `executeWatcherRecoveries` acts through. */
export interface RecoveryExecutionDeps {
  runCommand: CommandRunner;
  claudeProjectsDir: string;
  nowMs: number;
  /** Whether Claude will bring a stopped session back in `cwd`. */
  canRestartIn: (cwd: string) => boolean;
  /** Whether a stopped session's process has exited. */
  waitForExit: (sessionId: string) => boolean;
}

/** Recoveries carried out, the resume attempts to record, and the events to log. */
export interface ExecutedRecoveries {
  recoveries: WatcherRecovery[];
  attemptsByOwner: Record<string, string[]>;
  events: WatchEvent[];
}

/** What the reload fan-out does with one session. */
export enum ReloadAction {
  Respawn = "respawn",
  /** Stop, then resume on reconcile, so the session's own watchers come back with it. */
  ResumeReconcile = "resume-reconcile",
  Defer = "defer",
  NotifyManual = "notify-manual",
  Skip = "skip",
}

/** The fan-out's decision for one Claude session, with the reason shown to the user. */
export interface ReloadDecision {
  sessionId: string;
  shortId?: string;
  name?: string;
  cwd?: string;
  action: ReloadAction;
  reason: string;
}

/** What one reload pass decided and did. */
export interface ReloadReport {
  decisions: ReloadDecision[];
  respawnedSessionIds: string[];
  failedSessionIds: string[];
  /** Sessions left running because their workspace refused a background restart. */
  untrustedSessionIds: string[];
}

/** The reload the fan-out is working through: every session loaded before `changedAtMs` is behind. */
export interface PendingReload {
  changedAtMs: number;
  respawnedSessionIds: string[];
  notifiedSessionIds: string[];
  /** Sessions the fan-out will not touch again for this reload, such as ones in an untrusted workspace. */
  skippedSessionIds: string[];
}

/** A finding that was active at the end of the last tick. */
export interface ActiveFindingRecord {
  code: WatchFindingCode;
  severity: WatchFindingSeverity;
  subject: string;
  message: string;
  firstSeenAt: string;
}

/** A PR GitHub last reported merged or closed, so later ticks can skip asking until a recheck is due. */
export interface TerminalPrRecord {
  state: ProviderPrState;
  checkedAt: string;
}

/** How the active findings moved between the last tick and this one. */
export interface FindingTransitions {
  activeFindings: Record<string, ActiveFindingRecord>;
  raised: WatchFinding[];
  cleared: Array<{ key: string; record: ActiveFindingRecord }>;
}

/** What the watch carries from one tick to the next. */
export interface WatchLedgerState {
  activeFindings: Record<string, ActiveFindingRecord>;
  /** ISO timestamps of resume attempts, per owner session id. */
  recoveryAttemptsByOwner: Record<string, string[]>;
  /** PRs GitHub reported terminal while their slot still lists them open, keyed by PR url. */
  terminalPrsByUrl: Record<string, TerminalPrRecord>;
  /** Kept per target build, so a session handled once for it is never retried or re-notified. */
  pendingReload?: PendingReload;
}

/** The kinds of line `events.jsonl` holds. */
export enum WatchEventKind {
  Raised = "raised",
  Cleared = "cleared",
  Resumed = "resumed",
  ResumeFailed = "resume-failed",
  ReloadRequested = "reload-requested",
  Respawned = "respawned",
  RespawnFailed = "respawn-failed",
  RestartRefused = "restart-refused",
  ClosedOut = "closed-out",
}

/** One line of `events.jsonl`. */
export interface WatchEvent {
  at: string;
  kind: WatchEventKind;
  key?: string;
  code?: WatchFindingCode;
  subject?: string;
  message?: string;
}

/** Everything one tick saw and did, as `status.json` stores it. */
export interface WatchSnapshot {
  takenAt: string;
  /** The muggle works build installed now, when the install log names one. */
  installedVersion?: string;
  sessions: WorkSession[];
  processes: TrackedProcess[];
  slots: WatchSlotAssessment[];
  coverage: RepoCoverage[];
  /** Slots this tick closed out because GitHub reported their PR merged or closed. */
  closedOutSlugs: string[];
  findings: WatchFinding[];
  recoveries: WatcherRecovery[];
  reload?: ReloadReport;
}

/** Where the watch reads its sources and keeps its ledger. */
export interface WatchPaths {
  watchDir: string;
  slotsDir: string;
  claudeSessionRegistryDir: string;
  claudeProjectsDir: string;
  claudeInstalledPluginsFile: string;
  codexSessionsDir: string;
  muggleInstallLogFile: string;
}

/** A finished child process: its exit code and captured stdout. */
export interface CommandOutcome {
  exitCode: number;
  stdout: string;
}

/** Where a spawned command runs. */
export interface CommandOptions {
  cwd?: string;
  /** Overrides the runner's default timeout. */
  timeoutMs?: number;
  /** Append stderr to the returned output, for a command whose failures only say why there. */
  isStderrCaptured?: boolean;
}

/** What one install, refresh or removal of the watch's scheduled task did. */
export enum WatchServiceInstallOutcome {
  Installed = "installed",
  Refreshed = "refreshed",
  Removed = "removed",
  /** The preference did not call for an install and none was registered to refresh. */
  NotRequested = "not-requested",
  /** The preference is `never`. */
  TurnedOff = "turned-off",
  /** This platform has no installer; the report carries the crontab line instead. */
  Unsupported = "unsupported",
  Failed = "failed",
}

/** The outcome of a watch-service install, with the installer's output or the reason it did not run. */
export interface WatchServiceInstallReport {
  outcome: WatchServiceInstallOutcome;
  detail: string;
}

/** Edges a watch-service install needs. */
export interface WatchServiceInstallDeps {
  platform: NodeJS.Platform;
  runCommand: CommandRunner;
  homeDir: string;
  /** The watch ledger dir; the launcher and its environment are staged in its `bin`. */
  watchDir: string;
  /** The installing shell's environment: its PATH is what the scheduled tick runs with. */
  env: NodeJS.ProcessEnv;
  /** The node binary the scheduled tick runs under. */
  nodePath: string;
  /** POSIX only: the user id launchd's per-user domain is named for. */
  uid?: number;
}

/** The OS scheduler a platform's watch service runs under. */
export enum WatchSchedulerKind {
  TaskScheduler = "task-scheduler",
  Launchd = "launchd",
  SystemdUser = "systemd-user",
  Cron = "cron",
}

/** Everything a POSIX scheduler entry names: the staged launcher and what it runs. */
export interface PosixTickJob {
  launcherPath: string;
  nodePath: string;
  muggleEntry: string;
  intervalSeconds: number;
}

/** What one scheduler change did, with the line reported to the user. */
export interface SchedulerOutcome {
  isDone: boolean;
  detail: string;
}

/** Where the POSIX scheduler files of one user live. */
export interface PosixSchedulePaths {
  launchdPlistFile: string;
  systemdServiceFile: string;
  systemdTimerFile: string;
  /** Scratch file `crontab` installs the edited table from. */
  crontabStagingFile: string;
}

/** Runs an executable with no shell and no window; null when it could not start or timed out. */
export type CommandRunner = (
  executable: string,
  args: string[],
  options?: CommandOptions,
) => CommandOutcome | null;

/** Shows one desktop notification. Best-effort: the implementation swallows its own failures. */
export type DesktopNotifier = (title: string, lines: string[]) => void;

/** The side-effecting edges a tick runs through, injected so the logic is testable. */
export interface WatchTickDeps {
  nowMs: number;
  platform: NodeJS.Platform;
  paths: WatchPaths;
  runCommand: CommandRunner;
  notify: DesktopNotifier;
  isAutoReloadEnabled: boolean;
  isRecoveryEnabled: boolean;
  /** Pause between listings while a restart waits for a stopped session to exit; blocks the thread when unset. */
  sleep?: (durationMs: number) => void;
}
