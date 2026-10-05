import { HookEvent, type HookSlotCap } from "./types.js";

/** Longest `timeout` (seconds) a hook on a per-turn or per-tool event may declare. */
export const MAX_HOT_PATH_TIMEOUT_SECONDS = 30;

/** Longest `timeout` (seconds) a SessionStart hook may declare; it runs once per session. */
export const MAX_SESSION_START_TIMEOUT_SECONDS = 120;

/** Per-slot ceiling for firing every hook in the slot under the spawn-counting shims. */
export const NOOP_MEASUREMENT_TIMEOUT_MS = 120_000;

/** Ratchet ceiling on hook commands across the whole manifest, every event and matcher. */
export const MAX_TOTAL_HOOK_COMMANDS = 15;

/** Programs whose cold start dwarfs a hook's real work; none may run when the event is irrelevant. */
export const NOOP_FORBIDDEN_PROGRAMS = ["node", "gh", "python", "python3"];

/** Programs the spawn-counting harness shims; a hook reaching for anything else fails the suite. */
export const SHIMMED_PROGRAMS = [
  "bash", "sh", "cat", "grep", "egrep", "sed", "head", "tail", "awk", "cut", "tr", "wc", "sort", "uniq",
  "ls", "stat", "date", "basename", "dirname", "mkdir", "rm", "mv", "cp", "touch", "find", "xargs",
  "tee", "env", "sleep", "jq", "node", "gh", "python", "python3", "cygpath", "uname",
];

const NOOP_SESSION_ID = "footprint-noop";

/** Stands in for transcript_path; the harness swaps in a real file, since Claude Code always sends one. */
export const NOOP_TRANSCRIPT_PLACEHOLDER = "<footprint-transcript>";

/** Wall-time budget for one no-op firing of a slot, enforced on Linux and macOS runners. */
export const NOOP_FIRING_BUDGET_MS = 100;

/** Firings timed per slot; the median is compared with the budget so one noisy run cannot fail CI. */
export const NOOP_FIRING_TIMING_RUNS = 5;

/**
 * Per-slot ceilings, set at the lazy-core targets: one hook command per hot slot and no program
 * started beyond it when the event is irrelevant. CI fails when a change exceeds a ceiling, and
 * also when it beats one until the ceiling is lowered to match, so a gain cannot be given back.
 */
export const HOT_PATH_SLOT_CAPS: HookSlotCap[] = [
  {
    slot: { event: HookEvent.PreToolUse, toolName: "Bash" },
    maxCommands: 1,
    maxNoopSpawns: 0,
    noopPayload: { session_id: NOOP_SESSION_ID, tool_name: "Bash", tool_input: { command: "ls" } },
  },
  {
    slot: { event: HookEvent.PostToolUse, toolName: "Bash" },
    maxCommands: 1,
    maxNoopSpawns: 0,
    noopPayload: {
      session_id: NOOP_SESSION_ID,
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { stdout: "README.md\n", stderr: "", interrupted: false },
    },
  },
  {
    slot: { event: HookEvent.PostToolUse, toolName: "Read" },
    maxCommands: 1,
    maxNoopSpawns: 0,
    noopPayload: {
      session_id: NOOP_SESSION_ID,
      tool_name: "Read",
      tool_input: { file_path: "/tmp/notes.txt" },
      tool_response: { type: "text" },
    },
  },
  {
    slot: { event: HookEvent.Stop },
    maxCommands: 1,
    // The capability-claim gate tails the transcript until it has nudged once: bash cannot seek.
    maxNoopSpawns: 1,
    noopPayload: { session_id: NOOP_SESSION_ID, stop_hook_active: false, transcript_path: NOOP_TRANSCRIPT_PLACEHOLDER },
  },
  {
    slot: { event: HookEvent.UserPromptSubmit },
    maxCommands: 1,
    maxNoopSpawns: 0,
    noopPayload: { session_id: NOOP_SESSION_ID, prompt: "what is the status of the rollout" },
  },
];
