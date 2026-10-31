/** Claude Code hook events the plugin registers observers on. */
export enum HookEvent {
  SessionStart = "SessionStart",
  PreToolUse = "PreToolUse",
  PostToolUse = "PostToolUse",
  Stop = "Stop",
  UserPromptSubmit = "UserPromptSubmit",
}

/** One command entry inside a hooks.json group. */
export interface HookCommand {
  type: string;
  /** Claude Code permission-rule syntax, e.g. `Bash(*gh *)`: the hook launches only for the calls it matches. */
  if?: string;
  command: string;
  timeout?: number;
  async?: boolean;
  /** Runs in the background and wakes Claude with its stderr when it exits 2; nothing waits on it. */
  asyncRewake?: boolean;
}

/** Timeout ceilings, in seconds, for the hooks of one event. */
export interface HookTimeoutCaps {
  /** Longest `timeout` any one hook may declare. */
  perHookSeconds: number;
  /** Longest summed `timeout` of the hooks one firing launches. */
  perFiringSeconds: number;
}

/** A hooks.json group: an optional tool-name regex and the commands it runs. */
export interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}

/** The parsed plugin/hooks/hooks.json manifest. */
export interface HooksManifest {
  hooks: Record<string, HookGroup[]>;
}

/** `OSTYPE` values that steer hook-entry.sh: Git Bash sources a hook's script in place, any other shell gives it a bash of its own. */
export enum HookShellOstype {
  GitBash = "msys",
  Cygwin = "cygwin",
  Linux = "linux-gnu",
}

/** A hot-path firing: an event, plus the tool name when the event is tool-scoped. */
export interface HookSlot {
  event: HookEvent;
  toolName?: string;
}

/** Ratcheted ceilings for one hot-path slot, and the payload that exercises its no-op path. */
export interface HookSlotCap {
  slot: HookSlot;
  /** Hook commands the harness launches per firing. Design target: 1. */
  maxCommands: number;
  /** Programs the commands exec beyond their own launch when the event is irrelevant. Design target: 0. */
  maxNoopSpawns: number;
  noopPayload: Record<string, unknown>;
}

/** What one no-op firing of a slot cost. */
export interface SlotFootprint {
  commandCount: number;
  /** Commands that started a bash of their own to run their script; hook-entry.sh starts none inside Git Bash. */
  ownLaunchCount: number;
  /** Program names each command exec'd after its own launch, in order, one entry per spawn. */
  spawnedPrograms: string[];
  /** Programs a hook tried to run that the shim directory does not provide. */
  unshimmedPrograms: string[];
}

/** How a runtime scenario's throwaway home is seeded before its hooks fire. */
export enum HomeSeed {
  /** An installed user with no state for the session: the irrelevant-event path. */
  Installed = "installed",
  /** No Electron or version cache and no upkeep stamp: the day the session-start upkeep comes due. */
  ColdCaches = "cold-caches",
  /** Electron and version caches fresh and the upkeep not yet due: an ordinary session start. */
  WarmCaches = "warm-caches",
  /** An acceptance run and an opened PR with no walkthrough: the Stop gates' `gh` lookups. */
  WalkthroughOwed = "walkthrough-owed",
  /** Green unit tests and an opened PR with no acceptance run: the E2E gate's comment settle. */
  E2eOwed = "e2e-owed",
  /** A slot the session owns whose watch recorded a stale branch and a red head nothing acted on: the follow-through gate's reads. */
  WatchWorkOwed = "watch-work-owed",
}

/** One timed firing: the slot, the payload Claude Code would send, and the state its hooks find on disk. */
export interface HookRuntimeScenario {
  label: string;
  slot: HookSlot;
  homeSeed: HomeSeed;
  payload: Record<string, unknown>;
}

/** Wall time of one hook command across a scenario's timed runs. */
export interface CommandRuntime {
  command: string;
  medianMs: number;
  runsMs: number[];
}

/** What a scenario's timed runs cost, and the throwaway homes they ran in. */
export interface ScenarioRuntime {
  commandRuntimes: CommandRuntime[];
  homes: string[];
}
