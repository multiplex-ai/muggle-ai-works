/** Knobs of the agent-gate eval: its agent SDK harness, its Codex harness (codex-harness.ts), and their hooks. */

import { fileURLToPath } from "node:url";

import { z } from "zod";

import { type AgentScenarioExpectation, type HostStubSpec, ScriptedTool } from "./types.js";

/** The file the Codex hook appends each tool call to, per rep. */
export const CODEX_AGENT_TRACE_ENV = "MUGGLE_AGENT_EVAL_TRACE";

/** The scenario's scripted shell outputs, as a JSON file the Codex hook reads. */
export const CODEX_AGENT_BASH_ENV = "MUGGLE_AGENT_EVAL_BASH";

/** The plugin tree, whose files a shell read may really open — the agent SDK harness's Read scope. */
export const CODEX_AGENT_READ_ROOT_ENV = "MUGGLE_AGENT_EVAL_READ_ROOT";

/** Codex's own question tool — what plays AskUserQuestion's part, which no agent may call. */
export const CODEX_ASK_QUESTION_TOOL = "request_user_input";

/** The sandbox a rep's real plugin reads run in; every other command is scripted and never runs. */
export const DEFAULT_CODEX_AGENT_SANDBOX = "read-only";

/** Returned for a Bash command no scripted response matches. */
export const UNSCRIPTED_BASH_RESPONSE = "(exit 0, no output)";

/** Prefixes every scripted Bash answer, on both hosts; the Codex hook spells it out itself. */
export const SIMULATED_OUTPUT_PREFIX = "SIMULATED OUTPUT (treat as the command's real result):\n";

/** Returned for a scripted tool call no `toolResponses` entry matches. */
export const UNSCRIPTED_TOOL_RESPONSE = "(recorded by the eval harness; nothing ran)";

/** The denial an unscripted AskUserQuestion gets: there is no user to answer it. */
export const NO_USER_RESPONSE =
  "[harness] there is no user in this environment — return a `needs-input:` line instead of asking";

/** Reps per scenario when `--runs` is unset. */
export const DEFAULT_AGENT_RUNS = 5;

/** Turn cap when neither the caller nor the scenario sets one. */
export const DEFAULT_MAX_TURNS = 60;

/** The SDK's terminal result subtype for a run that reached its turn cap. */
export const MAX_TURNS_RESULT_SUBTYPE = "error_max_turns";

/** The model a skill runs on when neither `--model` nor its frontmatter names one. */
export const DEFAULT_SKILL_MODEL = "claude-sonnet-5-5";

/** Name of the in-process mock muggle server; its tools surface as `mcp__eval_mock__<tool>`. */
export const MOCK_MCP_SERVER_NAME = "eval_mock";

/** Prefix the agent SDK gives every mock muggle tool. */
export const MOCK_MCP_PREFIX = `mcp__${MOCK_MCP_SERVER_NAME}__`;

/** Every muggle tool's bare name starts with this, mock and production alike. */
export const MUGGLE_TOOL_NAME_PREFIX = "muggle-";

/** Prefix of the production muggle plugin's tools, which must never answer inside an eval. */
export const PRODUCTION_MUGGLE_PREFIX = "mcp__plugin_muggle_muggle__";

/** Name of the in-process server carrying the host-tool stubs; its tools surface as `mcp__eval_host__<tool>`. */
export const HOST_STUB_SERVER_NAME = "eval_host";

/** Prefix the agent SDK gives every host-tool stub. */
export const HOST_STUB_PREFIX = `mcp__${HOST_STUB_SERVER_NAME}__`;

/** Version the eval's in-process MCP servers report. */
export const EVAL_MCP_SERVER_VERSION = "0.0.0-eval";

/** Built-in tools a plugin agent target is offered. */
export const AGENT_BUILTIN_TOOLS = ["Read", "Bash", ScriptedTool.AskUserQuestion];

/** Built-in tools a skill target is offered; its orchestration tools come as host stubs. */
export const SKILL_BUILTIN_TOOLS = ["Read", "Write", "Edit", "Bash", ScriptedTool.AskUserQuestion];

/** Built-in tools that write files, confined to the sandbox. */
export const WRITE_TOOLS = ["Write", "Edit"];

/** File tools a transcript answers itself: a Read returns the file, and a Write or Edit is applied to the sandbox. */
export const TRANSCRIPT_FILE_TOOLS = ["Read", ...WRITE_TOOLS];

/** The expectation lists that hold tool-attempt patterns, where `{ "pattern": "<name>" }` references resolve. */
export const TOOL_PATTERN_EXPECTATION_KEYS = [
  "requireToolAttempts",
  "forbidToolAttempts",
  "requireToolSequence",
] as const satisfies ReadonlyArray<keyof AgentScenarioExpectation>;

/** How much of the offending attempt's serialized input a failed `requireLastAmong` reason quotes. */
export const LAST_AMONG_ARGS_PREVIEW_CHARS = 160;

/** What the Write tool answers, before the path. */
export const WRITE_CONFIRMATION_PREFIX = "File created successfully at: ";

/** What the Edit tool answers, around the path. */
export const EDIT_CONFIRMATION_PARTS = ["The file ", " has been updated successfully."] as const;

/** The `userType` Claude Code records on every entry of an interactive session's transcript. */
export const TRANSCRIPT_USER_TYPE = "external";

/** Prefix of a seeded transcript's message ids, so a replayed turn is never mistaken for a real API response. */
export const TRANSCRIPT_MESSAGE_ID_PREFIX = "msg_eval_";

/** Prefix of a seeded transcript's tool-use ids. */
export const TRANSCRIPT_TOOL_USE_ID_PREFIX = "toolu_eval_";

/** How long before the run a seeded transcript's first entry is dated, so its timestamps all sit in the past. */
export const TRANSCRIPT_START_OFFSET_MS = 60 * 60 * 1000;

/** The SDK's own name for the subagent tool, which it lists beside `Agent`. */
export const LEGACY_AGENT_TOOL = "Task";

/**
 * Host tools the SDK runs without consulting canUseTool, each replaced by a
 * same-named stub. Skill, Agent and CronDelete validate their input before any
 * hook fires (an unknown skill, subagent type, or job id never reaches one);
 * TodoWrite, CronCreate, CronList, Monitor and TaskStop would really run, against
 * the eval host's own session. Each shape mirrors the built-in tool's fields,
 * since zod strips undeclared keys from what the stub sees.
 */
export const HOST_STUB_SPECS: HostStubSpec[] = [
  {
    tool: ScriptedTool.Skill,
    description:
      "Invoke a skill by name, with optional arguments. If a <command-name> block is already present this turn, that skill is loaded — follow it directly rather than calling it again.",
    shape: { skill: z.string(), args: z.string().optional() },
  },
  {
    tool: ScriptedTool.Agent,
    description: "Dispatch a subagent with a task prompt and wait for its report.",
    shape: {
      description: z.string(),
      prompt: z.string(),
      subagent_type: z.string().optional(),
      model: z.string().optional(),
      run_in_background: z.boolean().optional(),
    },
  },
  {
    tool: ScriptedTool.TodoWrite,
    description: "Replace the session's todo list.",
    shape: {
      todos: z.array(
        z.object({ content: z.string(), status: z.string(), activeForm: z.string().optional() }),
      ),
    },
  },
  {
    tool: ScriptedTool.CronCreate,
    description: "Schedule a prompt on a cron expression.",
    shape: {
      cron: z.string(),
      prompt: z.string(),
      recurring: z.boolean().optional(),
      durable: z.boolean().optional(),
    },
  },
  {
    tool: ScriptedTool.CronList,
    description: "List the session's scheduled jobs with their ids and prompts.",
    shape: {},
  },
  {
    tool: ScriptedTool.CronDelete,
    description: "Cancel a scheduled job by id.",
    shape: { id: z.string() },
  },
  {
    tool: ScriptedTool.Monitor,
    description: "Run a command in the background and stream each output line back as an event.",
    shape: {
      command: z.string(),
      description: z.string(),
      timeout_ms: z.number().optional(),
      persistent: z.boolean().optional(),
    },
  },
  {
    tool: ScriptedTool.TaskStop,
    description: "Stop a running background task, such as a PR watch loop, by its task id.",
    shape: { task_id: z.string() },
  },
];

/** Built-in tool names a host stub stands in for, including the SDK's legacy name for Agent. */
export const STUBBED_BUILTIN_TOOL_NAMES = new Set<string>([
  ...HOST_STUB_SPECS.map((spec) => spec.tool),
  LEGACY_AGENT_TOOL,
]);

/** How every target's environment note explains scripted Bash. */
export const SCRIPTED_BASH_NOTE_LINES = [
  "Bash commands do not execute here. Every Bash call is intercepted and the",
  "permission message carries that command's REAL observed output for this",
  "environment (marked SIMULATED OUTPUT). Treat it exactly as if the command",
  "ran and printed it; do not re-run a command whose output you already have.",
];

/** `muggle-remote-test-case-ancestors-get`'s answer when the scenario scripts none: a root case with no prerequisites. */
export const DEFAULT_TEST_CASE_ANCESTORS = { testCaseId: "tc-stub", ancestors: [], orphan: false };

/** `muggle-remote-test-script-get`'s answer when the scenario scripts none. */
export const DEFAULT_TEST_SCRIPT = { id: "cloud-ts-stub", steps: [] };

/** `muggle-remote-action-script-get`'s answer when the scenario scripts none. */
export const DEFAULT_ACTION_SCRIPT = { id: "cloud-as-stub", steps: [], actionParams: {} };

/** A list tool's answer when the scenario scripts none. */
export const EMPTY_MOCK_LIST = { items: [] };

/** Id prefix of the use cases a run creates, numbered from 1 in creation order. */
export const CREATED_USE_CASE_ID_PREFIX = "uc-new-";

/** Id prefix of the test cases a run creates, numbered from 1 in creation order. */
export const CREATED_TEST_CASE_ID_PREFIX = "tc-new-";

/** The status a test case the run creates starts in, before any script is generated for it. */
export const CREATED_TEST_CASE_STATUS = "DRAFT";

/** How the environment note points a run at the mock muggle tools. */
export const MOCK_MCP_NOTE_LINES = [
  "The production `mcp__plugin_muggle_muggle__*` tools are NOT available;",
  `call the matching \`${MOCK_MCP_PREFIX}*\` tools instead. They return canned`,
  "results so you can run and report without auth, cloud, or a real browser.",
  "A bare tool name in your instructions (e.g.",
  "`muggle-local-execute-replay`) resolves to",
  `\`${MOCK_MCP_PREFIX}muggle-local-execute-replay\`.`,
];

/** The line the Skill tool puts before a skill's body, naming the directory its relative links resolve from. */
export const SKILL_BASE_DIRECTORY_PREFIX = "Base directory for this skill: ";

/** The placeholder a skill body uses for its invocation arguments. */
export const SKILL_ARGUMENTS_PLACEHOLDER = "$ARGUMENTS";

/** Prefixes the arguments the Skill tool appends to a body that has no `$ARGUMENTS` placeholder. */
export const SKILL_ARGUMENTS_PREFIX = "ARGUMENTS: ";

/** Header of the SessionStart preferences block, as plugin/scripts/ensure-electron-app.sh emits it. */
export const PREFERENCES_CONTEXT_HEADER = "Muggle Test Preferences (~/.muggle-ai/preferences.json):";

/** The shipped preference defaults, relative to the plugin tree. */
export const PREFERENCE_DEFAULTS_PATH = "config/preference-defaults.json";

/** Fixture repositories a scenario's `seed.repo` names. */
export const FIXTURE_REPOS_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

/** Prefix of each run's sandbox directory under the OS temp dir. */
export const SANDBOX_DIR_PREFIX = "muggle-agent-eval-run-";

/** Env var that relocates the Claude Code CLI's config dir (CI points it at a temp dir). */
export const CLAUDE_CONFIG_DIR_ENV = "CLAUDE_CONFIG_DIR";

/** The CLI's config dir under the home directory when CLAUDE_CONFIG_DIR is unset. */
export const DEFAULT_CLAUDE_CONFIG_DIRNAME = ".claude";

/** The config subdirectory holding the CLI's per-project records. */
export const CLAUDE_PROJECTS_DIRNAME = "projects";

/** Prefix of the temporary config directory the agent SDK resumes a sessionStore session in, under the OS temp dir. */
export const RESUME_CONFIG_DIR_PREFIX = "claude-resume-";

/** Spellings of the home directory a path or command may open with. */
export const HOME_PATH_PREFIXES = ["~", "$HOME", "${HOME}"];

/** Scenario files are JSON; results files beside them carry this suffix and are skipped. */
export const RESULTS_FILE_SUFFIX = ".results.json";

/** Sits before RESULTS_FILE_SUFFIX in a Codex run's results file, so neither host overwrites the other. */
export const CODEX_RESULTS_INFIX = ".codex";

/** The most tool attempts a failed run's printed trace lists — its latest ones, where the miss usually is. */
export const FAILED_RUN_TRACE_MAX_ATTEMPTS = 60;

/** Characters of each attempt's input a failed run's printed trace keeps. */
export const FAILED_RUN_TRACE_ARGS_CHARS = 400;
