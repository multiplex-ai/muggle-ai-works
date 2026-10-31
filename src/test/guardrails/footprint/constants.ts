import { fileURLToPath } from "url";
import { EVENT_HOOK_RUNTIME_BUDGET_MS, HOOK_RUNTIME_BUDGET_MS } from "../../../hook-budget/constants.js";
import { watchSlotFiles } from "../support/watchSlotFixture.js";
import { HomeSeed, HookEvent, type HookRuntimeScenario, type HookSlotCap, type HookTimeoutCaps } from "./types.js";

/** The plugin tree whose hooks.json and scripts the harness fires. */
export const PLUGIN_ROOT = fileURLToPath(new URL("../../../../plugin", import.meta.url));

// The harness kills a hook at its timeout, so on the events that fire per tool call, prompt or turn end the timeout
// is the runtime cap itself.
const PER_EVENT_TIMEOUT_CAPS: HookTimeoutCaps = {
  perHookSeconds: HOOK_RUNTIME_BUDGET_MS / 1_000,
  perFiringSeconds: EVENT_HOOK_RUNTIME_BUDGET_MS / 1_000,
};

/**
 * Timeout ceilings per hook event. A SessionStart hook fires once per session and carries the session's whole muggle
 * context, so a loaded machine gets room to start bash and Node rather than drop that context at 1 s; the timed
 * scenarios still hold its runtime to HOOK_RUNTIME_BUDGET_MS.
 */
export const HOOK_TIMEOUT_CAPS: Record<HookEvent, HookTimeoutCaps> = {
  [HookEvent.SessionStart]: { perHookSeconds: 5, perFiringSeconds: 10 },
  [HookEvent.PreToolUse]: PER_EVENT_TIMEOUT_CAPS,
  [HookEvent.PostToolUse]: PER_EVENT_TIMEOUT_CAPS,
  [HookEvent.Stop]: PER_EVENT_TIMEOUT_CAPS,
  [HookEvent.UserPromptSubmit]: PER_EVENT_TIMEOUT_CAPS,
};

/**
 * Timeout ceiling for an `asyncRewake` companion, in seconds. Nothing waits on it, so its timeout costs no turn any
 * time; it only bounds how long it may wait for the transcript to record the synchronous run it backs.
 */
export const ASYNC_REWAKE_TIMEOUT_CAP_SECONDS = 30;

/** A hook's `if` rule: the tool it names, and the wildcard pattern over that tool's command; a bare tool name has none and matches every call. */
export const HOOK_IF_RULE = /^(\w+)(?:\((.*)\))?$/s;

/** Tools whose `if` patterns Claude Code matches ignoring case, as PowerShell itself reads commands. */
export const CASE_INSENSITIVE_IF_RULE_TOOLS = ["PowerShell"];

/** Characters a RegExp reads as syntax, escaped when an `if` pattern's literal text becomes one. */
export const REGEXP_SYNTAX_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

/** Per-slot ceiling for firing every hook in the slot under the spawn-counting shims. */
export const NOOP_MEASUREMENT_TIMEOUT_MS = 120_000;

/**
 * Ratchet ceiling on distinct hook commands across the whole manifest, every event and matcher. Two of them are the
 * Stop and UserPromptSubmit `asyncRewake` companions, which hold no turn but deliver what a cancelled synchronous run
 * would have said.
 */
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
    // The deny gates' `if` rules name gh and glab, so Claude Code launches nothing for any other command.
    maxCommands: 0,
    maxNoopSpawns: 0,
    noopPayload: { session_id: NOOP_SESSION_ID, tool_name: "Bash", tool_input: { command: "ls" } },
  },
  {
    slot: { event: HookEvent.PostToolUse, toolName: "Bash" },
    // Every Bash call launches the recorders: Claude Code's Bash parser gives up on about a sixth of real commands and
    // then launches every `if` variant, so a rule per trigger would launch more commands than it saves.
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
    slot: { event: HookEvent.PostToolUse, toolName: "PowerShell" },
    // The recorders' `if` rules name every command they act on, so Claude Code launches nothing for any other.
    maxCommands: 0,
    maxNoopSpawns: 0,
    noopPayload: {
      session_id: NOOP_SESSION_ID,
      tool_name: "PowerShell",
      tool_input: { command: "Get-ChildItem" },
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
    // The synchronous gates, and their asyncRewake companion, which nothing waits on.
    maxCommands: 2,
    // The capability-claim gate tails the transcript until it has nudged once: bash cannot seek. Both the synchronous
    // run and its companion pre-filter it.
    maxNoopSpawns: 2,
    noopPayload: { session_id: NOOP_SESSION_ID, stop_hook_active: false, transcript_path: NOOP_TRANSCRIPT_PLACEHOLDER },
  },
  {
    slot: { event: HookEvent.UserPromptSubmit },
    // The build router and its asyncRewake companion, which nothing waits on.
    maxCommands: 2,
    maxNoopSpawns: 0,
    noopPayload: { session_id: NOOP_SESSION_ID, prompt: "what is the status of the rollout" },
  },
];

/** Programs that reach the network or install software; the runtime harness swaps each for a stall. */
export const SLOW_PROGRAMS = ["gh", "muggle", "npm", "npx", "curl", "wget"];

/** How long each SLOW_PROGRAMS stand-in stalls: far past the budget, so a hook that waits on one fails. */
export const SLOW_PROGRAM_STALL_SECONDS = 5;

/** How far ahead a warm seed stamps the session-start upkeep's next due time, so no timed start launches it. */
export const UPKEEP_NOT_DUE_SECONDS = 24 * 60 * 60;

/** Longest wait for the upkeep a cold start launched to finish its sweep before the next scenario is timed. */
export const UPKEEP_SETTLE_TIMEOUT_MS = 30_000;

/** Interval between checks while waiting for that sweep. */
export const UPKEEP_SETTLE_POLL_MS = 100;

/** Firings timed per scenario; each command's median is held to the budget so one noisy run cannot fail CI. */
export const HOOK_RUNTIME_TIMING_RUNS = 3;

/** Per-scenario test ceiling: every timed run of every command, on a contended Windows runner. */
export const RUNTIME_MEASUREMENT_TIMEOUT_MS = 120_000;

/** The session every runtime scenario fires as, and whose state file a seed writes. */
export const RUNTIME_SESSION_ID = "runtime-budget";

// A PR on a repository that does not exist, so a real `gh` reached from a fixture can never post anywhere.
const FIXTURE_PR_URL = "https://github.com/footprint-fixture/no-such-repo/pull/1";

const MUGGLE_TOOL_PREFIX = "mcp__plugin_muggle_muggle__muggle-local-";

/** Session state each seed writes for RUNTIME_SESSION_ID; a seed absent here writes none. */
export const HOME_SEED_SESSION_STATES: Partial<Record<HomeSeed, Record<string, unknown>>> = {
  [HomeSeed.WalkthroughOwed]: {
    sessionId: RUNTIME_SESSION_ID,
    prsHandled: [FIXTURE_PR_URL],
    e2eRun: true,
    terminalPending: [1],
    failedRuns: ["run-1"],
  },
  [HomeSeed.E2eOwed]: { sessionId: RUNTIME_SESSION_ID, prsHandled: [FIXTURE_PR_URL], unitTestsGreen: true },
};

const FIXTURE_HEAD_SHA = "1".repeat(40);

/** muggle-do slots each seed writes, files by slug; a seed absent here writes none. */
export const HOME_SEED_SESSION_SLOTS: Partial<Record<HomeSeed, Record<string, Record<string, string>>>> = {
  [HomeSeed.WatchWorkOwed]: {
    "no-such-repo-pr1": watchSlotFiles({
      ownerSessionId: RUNTIME_SESSION_ID,
      prNumber: 1,
      headSha: FIXTURE_HEAD_SHA,
      rebaseDueKey: `${FIXTURE_HEAD_SHA}..${"2".repeat(40)}`,
      ciRedHeadSha: FIXTURE_HEAD_SHA,
    }),
  },
};

const RUNTIME_PAYLOAD_BASE = { session_id: RUNTIME_SESSION_ID, transcript_path: NOOP_TRANSCRIPT_PLACEHOLDER };

// Claude Code names every tool call, and the dispatcher claims a call by that name.
const RUNTIME_SHELL_RESULT_BASE = { ...RUNTIME_PAYLOAD_BASE, hook_event_name: HookEvent.PostToolUse, tool_use_id: "toolu_runtime" };

/**
 * Every firing the runtime budget is held to: each hooks.json group's irrelevant path and the payloads that make its
 * gates do real work, including the `gh` lookups and the session-start upkeep. A group no scenario fires fails CI.
 */
export const HOOK_RUNTIME_SCENARIOS: HookRuntimeScenario[] = [
  {
    label: "session start, upkeep due",
    slot: { event: HookEvent.SessionStart },
    homeSeed: HomeSeed.ColdCaches,
    payload: { ...RUNTIME_PAYLOAD_BASE, source: "startup" },
  },
  {
    label: "session start, caches fresh",
    slot: { event: HookEvent.SessionStart },
    homeSeed: HomeSeed.WarmCaches,
    payload: { ...RUNTIME_PAYLOAD_BASE, source: "startup" },
  },
  {
    label: "irrelevant shell command",
    slot: { event: HookEvent.PreToolUse, toolName: "Bash" },
    homeSeed: HomeSeed.Installed,
    payload: { ...RUNTIME_PAYLOAD_BASE, tool_name: "Bash", tool_input: { command: "ls" } },
  },
  {
    label: "PR description about to post",
    slot: { event: HookEvent.PreToolUse, toolName: "Bash" },
    homeSeed: HomeSeed.WalkthroughOwed,
    payload: {
      ...RUNTIME_PAYLOAD_BASE,
      tool_name: "Bash",
      tool_input: { command: 'gh pr create --title "Fix" --body "## Summary\nFix the flow."' },
    },
  },
  {
    label: "review thread about to resolve",
    slot: { event: HookEvent.PreToolUse, toolName: "PowerShell" },
    homeSeed: HomeSeed.WalkthroughOwed,
    payload: {
      ...RUNTIME_PAYLOAD_BASE,
      tool_name: "PowerShell",
      tool_input: { command: "gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: \"T1\"}) { thread { id } } }'" },
    },
  },
  {
    label: "test generation about to start",
    slot: { event: HookEvent.PreToolUse, toolName: `${MUGGLE_TOOL_PREFIX}execute-test-generation` },
    homeSeed: HomeSeed.WalkthroughOwed,
    payload: {
      ...RUNTIME_PAYLOAD_BASE,
      tool_name: `${MUGGLE_TOOL_PREFIX}execute-test-generation`,
      tool_input: { testCaseId: "tc-1" },
    },
  },
  {
    label: "irrelevant shell output",
    slot: { event: HookEvent.PostToolUse, toolName: "Bash" },
    homeSeed: HomeSeed.Installed,
    payload: {
      ...RUNTIME_SHELL_RESULT_BASE,
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { stdout: "README.md\n", stderr: "", interrupted: false },
    },
  },
  {
    label: "PR opened",
    slot: { event: HookEvent.PostToolUse, toolName: "Bash" },
    homeSeed: HomeSeed.Installed,
    payload: {
      ...RUNTIME_SHELL_RESULT_BASE,
      tool_name: "Bash",
      tool_input: { command: 'gh pr create --title "Fix" --body "Fix the flow."' },
      tool_response: { stdout: `${FIXTURE_PR_URL}\n`, stderr: "", interrupted: false },
    },
  },
  {
    label: "PR merged",
    slot: { event: HookEvent.PostToolUse, toolName: "Bash" },
    homeSeed: HomeSeed.WalkthroughOwed,
    payload: {
      ...RUNTIME_SHELL_RESULT_BASE,
      tool_name: "Bash",
      tool_input: { command: "gh pr merge 1 --squash" },
      tool_response: { stdout: "", stderr: "✓ Merged pull request #1 (Fix)\n", interrupted: false },
    },
  },
  {
    label: "review reply posted",
    slot: { event: HookEvent.PostToolUse, toolName: "PowerShell" },
    homeSeed: HomeSeed.WalkthroughOwed,
    payload: {
      ...RUNTIME_SHELL_RESULT_BASE,
      tool_name: "PowerShell",
      tool_input: { command: "gh api repos/footprint-fixture/no-such-repo/pulls/1/comments/7/replies -f body=Done" },
      tool_response: { stdout: "{}", stderr: "", interrupted: false },
    },
  },
  {
    label: "tests run, then a PR opened with a notes file",
    slot: { event: HookEvent.PostToolUse, toolName: "PowerShell" },
    homeSeed: HomeSeed.Installed,
    payload: {
      ...RUNTIME_SHELL_RESULT_BASE,
      tool_name: "PowerShell",
      tool_input: { command: "pnpm test; gh pr create --title Fix --body-file notes.md" },
      tool_response: { stdout: `Tests  3 passed\n${FIXTURE_PR_URL}\n`, stderr: "", interrupted: false },
    },
  },
  {
    label: "replay finished",
    slot: { event: HookEvent.PostToolUse, toolName: `${MUGGLE_TOOL_PREFIX}execute-replay` },
    homeSeed: HomeSeed.WalkthroughOwed,
    payload: {
      ...RUNTIME_PAYLOAD_BASE,
      tool_name: `${MUGGLE_TOOL_PREFIX}execute-replay`,
      tool_input: { testScriptId: "ts-1" },
      tool_response: { content: [{ type: "text", text: "Replay PASSED" }] },
    },
  },
  {
    label: "stage telemetry emitted",
    slot: { event: HookEvent.PostToolUse, toolName: `${MUGGLE_TOOL_PREFIX}telemetry-event-emit` },
    homeSeed: HomeSeed.WalkthroughOwed,
    payload: {
      ...RUNTIME_PAYLOAD_BASE,
      tool_name: `${MUGGLE_TOOL_PREFIX}telemetry-event-emit`,
      tool_input: { eventName: "stage-completed", properties: { stage: "build" } },
      tool_response: { content: [{ type: "text", text: "ok" }] },
    },
  },
  {
    label: "skill telemetry emitted",
    slot: { event: HookEvent.PostToolUse, toolName: `${MUGGLE_TOOL_PREFIX}telemetry-skill-emit` },
    homeSeed: HomeSeed.WalkthroughOwed,
    payload: {
      ...RUNTIME_PAYLOAD_BASE,
      tool_name: `${MUGGLE_TOOL_PREFIX}telemetry-skill-emit`,
      tool_input: { skillName: "muggle-test" },
      tool_response: { content: [{ type: "text", text: "ok" }] },
    },
  },
  {
    label: "skill invoked",
    slot: { event: HookEvent.PostToolUse, toolName: "Skill" },
    homeSeed: HomeSeed.Installed,
    payload: { ...RUNTIME_PAYLOAD_BASE, tool_name: "Skill", tool_input: { skill: "muggle:muggle-do" }, tool_response: {} },
  },
  {
    label: "skill file read",
    slot: { event: HookEvent.PostToolUse, toolName: "Read" },
    homeSeed: HomeSeed.WalkthroughOwed,
    payload: {
      ...RUNTIME_PAYLOAD_BASE,
      tool_name: "Read",
      tool_input: { file_path: "/home/user/.claude/plugins/muggle/skills/muggle-do/SKILL.md" },
      tool_response: { type: "text" },
    },
  },
  {
    label: "next options offered",
    slot: { event: HookEvent.PostToolUse, toolName: "AskUserQuestion" },
    homeSeed: HomeSeed.WalkthroughOwed,
    payload: { ...RUNTIME_PAYLOAD_BASE, tool_name: "AskUserQuestion", tool_input: { questions: [] }, tool_response: {} },
  },
  {
    label: "turn end, nothing owed",
    slot: { event: HookEvent.Stop },
    homeSeed: HomeSeed.Installed,
    payload: { ...RUNTIME_PAYLOAD_BASE, stop_hook_active: false },
  },
  {
    label: "turn end, walkthrough owed",
    slot: { event: HookEvent.Stop },
    homeSeed: HomeSeed.WalkthroughOwed,
    payload: { ...RUNTIME_PAYLOAD_BASE, stop_hook_active: false },
  },
  {
    label: "turn end, acceptance run owed",
    slot: { event: HookEvent.Stop },
    homeSeed: HomeSeed.E2eOwed,
    payload: { ...RUNTIME_PAYLOAD_BASE, stop_hook_active: false },
  },
  {
    label: "turn end, watcher work owed",
    slot: { event: HookEvent.Stop },
    homeSeed: HomeSeed.WatchWorkOwed,
    payload: { ...RUNTIME_PAYLOAD_BASE, stop_hook_active: false },
  },
  {
    label: "irrelevant prompt",
    slot: { event: HookEvent.UserPromptSubmit },
    homeSeed: HomeSeed.Installed,
    payload: { ...RUNTIME_PAYLOAD_BASE, prompt: "what is the status of the rollout" },
  },
  {
    label: "build request",
    slot: { event: HookEvent.UserPromptSubmit },
    homeSeed: HomeSeed.Installed,
    payload: { ...RUNTIME_PAYLOAD_BASE, prompt: "implement rate limiting and open a PR" },
  },
];
