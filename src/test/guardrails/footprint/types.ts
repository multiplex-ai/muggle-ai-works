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
  command: string;
  timeout?: number;
  async?: boolean;
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
  /** Program names each command exec'd after its own launch, in order, one entry per spawn. */
  spawnedPrograms: string[];
  /** Programs a hook tried to run that the shim directory does not provide. */
  unshimmedPrograms: string[];
}
