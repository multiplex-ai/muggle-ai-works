/**
 * Shared types for the agent-gate eval — the behavioral contract check for
 * plugin agents (`plugin/agents/*.md`) and skills (`plugin/skills/<name>/SKILL.md`).
 * Gates on the session's final report, its tool-attempt trace, and the files
 * it leaves in the run's sandbox.
 */

import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ZodRawShape } from "zod";

import type { EvalHost, Fixtures, MockToolSpec, ScenarioReport } from "../../skill-gate-eval/src/types.js";

/** What a scenario file evaluates: a plugin agent definition or a skill. */
export enum EvalTargetKind {
  Agent = "agent",
  Skill = "skill",
}

/** The plugin agent or skill a scenario file evaluates. */
export interface EvalTarget {
  kind: EvalTargetKind;
  /** The agent's frontmatter name, or the skill's directory name under `plugin/skills/`. */
  name: string;
}

/** When a scenario runs: on every in-scope PR, or only in the nightly sweep. */
export enum ScenarioCadence {
  Pr = "pr",
  Nightly = "nightly",
}

/** Tools the harness never runs: each call is recorded and answered from the scenario's `toolResponses`. */
export enum ScriptedTool {
  Skill = "Skill",
  Agent = "Agent",
  TodoWrite = "TodoWrite",
  CronCreate = "CronCreate",
  CronDelete = "CronDelete",
  Monitor = "Monitor",
  AskUserQuestion = "AskUserQuestion",
}

/** A scripted answer: one output for every matching call, or one per successive call with the last repeating. */
export interface ScriptedReply {
  /** The output every matching call gets; ignored when `sequence` is non-empty. */
  response?: string;
  /** Outputs for successive matching calls: the nth match gets the nth entry, and the last repeats. */
  sequence?: string[];
}

/**
 * A canned response for an intercepted Bash command. First match wins; `commandContains: ""` is the catch-all.
 * `{{home}}` and `{{repo}}` in the output become the run's sandbox paths.
 */
export interface ScriptedBashResponse extends ScriptedReply {
  commandContains: string;
  /**
   * Answers only once an earlier Bash command carried this substring: the
   * state a commit, push or rebase leaves behind, for the reads that follow it.
   */
  afterCommandContains?: string;
}

/**
 * A canned answer for a scripted tool call; `argContains` is matched against the JSON-serialized input. First match wins.
 * `{{home}}` and `{{repo}}` in the output become the run's sandbox paths.
 */
export interface ScriptedToolResponse extends ScriptedReply {
  argContains: string;
}

/** Scripted answers per tool, for the tools the harness never runs. */
export type ScriptedToolResponses = Partial<Record<ScriptedTool, ScriptedToolResponse[]>>;

/** A mock MCP fixture slot that answers successive calls in order; the last repeats. */
export interface SequencedFixture {
  sequence: unknown[];
}

/**
 * A mock muggle tool whose reply may read the call's input. The shared
 * skill-gate-eval tools ignore their input; this eval's supplemental tools
 * answer per id. Only fields the `shape` declares reach `reply`.
 */
export interface InputAwareMockToolSpec extends Omit<MockToolSpec, "reply"> {
  reply: (input: Record<string, unknown>) => unknown;
}

/**
 * Run-specific paths a scenario names by placeholder in seed file content and
 * scripted Bash output; each is filled in for the run's sandbox.
 */
export enum SandboxPathToken {
  Home = "{{home}}",
  Repo = "{{repo}}",
}

/** Matches one tool attempt by its tool name and what its JSON-serialized input carries. */
export interface SingleToolAttemptPattern {
  tool: string;
  /** A substring the serialized input must carry, or several it must carry every one of. */
  argContains: string | string[];
}

/** Matches an attempt any one of its alternatives matches: an action the instructions allow more than one way. */
export interface AnyOfToolAttemptPattern {
  anyOf: SingleToolAttemptPattern[];
}

/** A tool-attempt pattern: one call shape, or alternatives. */
export type ToolAttemptPattern = SingleToolAttemptPattern | AnyOfToolAttemptPattern;

/** In a scenario file, stands for the file's `patterns[pattern]`; replaced when the file loads. */
export interface ToolAttemptPatternReference {
  pattern: string;
}

/** Among the attempts one pattern matches, the latest must also match another: a step that has to close out its kind. */
export interface LastAmongExpectation {
  /** The attempts considered, e.g. every push, PR reply, skip declaration and watcher arm. */
  among: ToolAttemptPattern;
  /** What the latest of those attempts must match. */
  last: ToolAttemptPattern;
  /** Attempts that match `among` only in passing, such as a session note quoting `git push`, and are not candidates. */
  unless?: ToolAttemptPattern;
}

/** A file the run must leave behind: in the sandbox, or named by a recorded Write or Bash attempt. */
export interface ArtifactExpectation {
  /** `~/…` resolves in the sandbox home; a relative path resolves in the sandbox repo. */
  path: string;
  /** A substring the file, or the attempt that wrote it, must carry. */
  contains?: string;
  /** A regex source (no flags) the file, or the attempt that wrote it, must match — for where a value sits, not only that it appears. */
  matches?: string;
}

/**
 * A file written into the sandbox before the run; `~/…` lands in the sandbox home, a relative path in the repo.
 * `{{home}}` and `{{repo}}` in `content` become the run's sandbox paths.
 */
export interface SeedFile {
  path: string;
  content: string;
}

/** Run-specific paths a seeded transcript names by placeholder; each is filled in when the transcript is built. */
export enum TranscriptPathToken {
  Home = "{{home}}",
  Repo = "{{repo}}",
  PluginRoot = "{{pluginRoot}}",
}

/** One tool call in a seeded transcript, with what it returned. */
export interface TranscriptToolCall {
  /** The scenario name of the tool: a built-in (`Read`, `Bash`), a host stub (`Skill`, `TodoWrite`), or a mock muggle tool. */
  tool: string;
  input: Record<string, unknown>;
  /**
   * What the call returned. Unset, it is answered as the live run would
   * answer it: a Read from the file, a Write or Edit applied to the sandbox, a
   * Bash call or scripted tool from the scenario's scripts (counted apart from
   * the live run's), a mock muggle call from its fixture.
   */
  result?: string;
}

/** One assistant turn of a seeded transcript: its text, then its tool calls, each answered before the next turn. */
export interface TranscriptTurn {
  text?: string;
  toolCalls?: TranscriptToolCall[];
}

/** The prior turns a run resumes from, so a skill starts mid-pipeline instead of at its first step. */
export interface SeedTranscript {
  /** Assistant turns after the invocation message, oldest first. */
  turns: TranscriptTurn[];
  /** The user message the resumed session receives. */
  resumePrompt: string;
}

/** The sandbox's starting state. */
export interface ScenarioSeed {
  /** A directory under `fixtures/` copied in as the repository; unset, the repository starts empty. */
  repo?: string;
  files?: SeedFile[];
  /** Prior turns the run resumes from; its Write and Edit calls are applied to the sandbox after `files`. */
  transcript?: SeedTranscript;
}

/** A transcript tool call ready to replay: paths filled in, named as the session names the tool, and its result known. */
export interface MaterializedToolCall {
  sessionToolName: string;
  input: Record<string, unknown>;
  result: string;
  /** Set where the live harness answers the call with a denial, as it does every Bash call. */
  isError: boolean;
}

/** A transcript turn ready to replay. */
export interface MaterializedTurn {
  text?: string;
  toolCalls: MaterializedToolCall[];
}

/** What the transcript's session entries carry besides the turns themselves. */
export interface TranscriptEntryContext {
  sessionId: string;
  cwd: string;
  model: string;
  /** The first entry's timestamp; each later entry is one second on. */
  startedAt: Date;
}

/** What a run resumed from a seeded transcript passes to the SDK. */
export interface TranscriptResume {
  /** The message the resumed session receives. */
  prompt: string;
  queryOptions: Pick<Options, "resume" | "sessionStore">;
}

/** The run a transcript is materialized into, and how it answers a call the transcript gives no result. */
export interface TranscriptMaterializeContext {
  paths: SandboxPathContext;
  pluginRoot: string;
  answerBash: (command: string) => string;
  answerTool: (tool: ScriptedTool, serializedInput: string) => string;
  /** A mock muggle tool's reply as MCP text, by bare tool name. */
  answerMockTool: (toolName: string) => string;
}

/** Everything resuming from a seeded transcript needs to know about the run. */
export interface TranscriptResumeRequest {
  transcript: SeedTranscript;
  /** The run's first user message — for a skill target, the invocation. */
  firstUserMessage: string;
  model: string;
  context: TranscriptMaterializeContext;
}

/** What one run must show for the scenario to pass. */
export interface AgentScenarioExpectation {
  /** Substrings that must appear in the final report. */
  outputContains?: string[];
  /** Regex sources (no flags) that must match the final report. */
  outputMatches?: string[];
  /** Substrings that must NOT appear in the final report. */
  outputNotContains?: string[];
  /** Regex sources that must NOT match the final report. */
  outputNotMatches?: string[];
  /** Tool attempts the run must have made (e.g. ran `muggle build-pr-section`). */
  requireToolAttempts?: ToolAttemptPattern[];
  /** Tool attempts the run must NOT have made (e.g. `gh pr comment` in a render-only mode). */
  forbidToolAttempts?: ToolAttemptPattern[];
  /** Attempts that must occur in this order, each after the previous; other attempts may interleave. */
  requireToolSequence?: ToolAttemptPattern[];
  /**
   * Several orders, each checked on its own like `requireToolSequence` — for steps that must each follow
   * their own predecessor (a stage's file read before that stage's action) without one fixed order across them.
   */
  requireToolSequences?: ToolAttemptPattern[][];
  /** For each entry, the latest attempt `among` matches must match `last`; no attempt matching `among` fails it. */
  requireLastAmong?: LastAmongExpectation[];
  /** Files the run must leave in the sandbox or name in a recorded Write or Bash attempt. */
  requireArtifacts?: ArtifactExpectation[];
  /**
   * The no-user-channel contract: agents never ask the user. Defaults to true;
   * a scenario can only relax it explicitly.
   */
  forbidAskUserQuestion?: boolean;
  /**
   * The most AskUserQuestion calls the run may make, for a flow that owes the user exactly one
   * consolidated question. Set, it replaces `forbidAskUserQuestion`.
   */
  maxAskUserQuestions?: number;
}

/** One behavioral scenario, run N times. */
export interface AgentScenario {
  name: string;
  /**
   * Agent targets: the dispatch prompt the dispatching skill would send.
   * Skill targets: the invocation's arguments, as typed after `/<skill>`.
   */
  prompt: string;
  /** Scripted results for intercepted Bash calls. */
  bashResponses?: ScriptedBashResponse[];
  /**
   * Canned muggle MCP responses, in the shape skill-gate-eval's mock server
   * reads; a slot may hold a `SequencedFixture`. Agent targets mount the mock
   * server only when this is present; skill targets always mount it.
   */
  fixtures?: Fixtures;
  /** Answers for the scripted tools, keyed by tool. */
  toolResponses?: ScriptedToolResponses;
  /** Skill targets: preferences the synthesized SessionStart line sets over the shipped defaults. */
  preferences?: Record<string, string>;
  seed?: ScenarioSeed;
  /** Turn cap for this scenario; unset, DEFAULT_MAX_TURNS. */
  maxTurns?: number;
  /**
   * Set when the scenario judges only how a run begins: reaching `maxTurns` ends the run and it is
   * judged on what it did by then, instead of counting as an aborted run.
   */
  stopsAtMaxTurns?: boolean;
  /** Unset, the scenario runs on every in-scope PR. */
  cadence?: ScenarioCadence;
  expect: AgentScenarioExpectation;
}

/**
 * What a file's `defaults` gives each of its scenarios. A scenario's own
 * `prompt`, `seed` and `maxTurns` replace the default's; `preferences` and
 * `fixtures` merge over it key by key; its `bashResponses` and each
 * `toolResponses` list go ahead of the default's, so they win the first match.
 */
export type ScenarioDefaults = Partial<
  Pick<AgentScenario, "prompt" | "seed" | "maxTurns" | "preferences" | "fixtures" | "bashResponses" | "toolResponses">
>;

/** A `scenarios/<stem>.json` file: one target, its scenarios, and the pass bar they share. */
export interface AgentScenarioFile {
  /** The file stem is the target's name, or starts with `<name>.` for a second suite on one target. */
  target: EvalTarget;
  /** Per-scenario pass-rate floor; unset, PASS_THRESHOLD. */
  passThreshold?: number;
  /** Shared by every scenario in the file; applied when it loads. */
  defaults?: ScenarioDefaults;
  /** Named tool-attempt patterns an expectation names with `{ "pattern": "<name>" }`. */
  patterns?: Record<string, ToolAttemptPattern>;
  /** Each with the file's defaults applied and its pattern references replaced. */
  scenarios: AgentScenario[];
}

/** One loaded scenario file and the stem `--suite` names it by. */
export interface ScenarioSuite {
  stem: string;
  filePath: string;
  file: AgentScenarioFile;
}

/** A markdown definition split at its frontmatter fence. */
export interface ParsedFrontmatter {
  /** The YAML between the `---` fences. */
  block: string;
  /** Everything after the closing fence. */
  body: string;
}

/** Where the runner finds each kind of target. */
export interface TargetDirectories {
  agentsDir: string;
  skillsDir: string;
}

/** Parsed `plugin/agents/<name>.md`. */
export interface AgentDefinition {
  kind: EvalTargetKind.Agent;
  name: string;
  /** Frontmatter `model:` alias (haiku/sonnet/opus/…) — unresolved. */
  modelAlias: string;
  /** Resolved concrete model id the eval runs on. */
  model: string;
  /** Markdown body with the frontmatter block stripped. */
  body: string;
  /** Absolute path of the definition file (used to resolve its relative links). */
  filePath: string;
}

/** Parsed `plugin/skills/<name>/SKILL.md`. */
export interface SkillDefinition {
  kind: EvalTargetKind.Skill;
  name: string;
  /** Frontmatter `model:` alias, when the skill pins one. */
  modelAlias?: string;
  /** Resolved model id: `--model`, else the frontmatter pin, else DEFAULT_SKILL_MODEL. */
  model: string;
  /** Markdown body with the frontmatter block stripped. */
  body: string;
  /** Absolute path of SKILL.md. */
  filePath: string;
  /** The skill's directory, which its relative links resolve from. */
  baseDir: string;
}

/** A loaded eval target. */
export type TargetDefinition = AgentDefinition | SkillDefinition;

/** One tool attempt captured by the harness — name plus raw input. */
export interface ToolAttempt {
  tool: string;
  args: Record<string, unknown>;
}

/** What one run spent, from the SDK's terminal result. */
export interface RunUsage {
  costUsd: number;
  durationMs: number;
  turns: number;
}

/** One run's verdict and the trace it was judged on. */
export interface AgentRunVerdict {
  scenario: string;
  pass: boolean;
  reasons: string[];
  trace: {
    finalOutput: string;
    toolAttempts: ToolAttempt[];
    askQuestionCount: number;
  };
  /** Absent when the run ended without a terminal result. */
  usage?: RunUsage;
}

/** One scenario's pass rate over its reps, plus what a rep cost on average. */
export interface AgentScenarioReport extends ScenarioReport {
  /** Null when no rep reported usage. */
  meanCostUsd: number | null;
  meanDurationMs: number | null;
}

/** One scenario run under the agent SDK. */
export interface AgentRunOptions {
  definition: TargetDefinition;
  scenario: AgentScenario;
  /** Overrides the scenario's `maxTurns`. */
  maxTurns?: number;
}

/** One agent scenario run under Codex (codex-harness.ts), which runs plugin agents only. */
export interface CodexAgentRunOptions extends Omit<AgentRunOptions, "definition"> {
  definition: AgentDefinition;
  /** The Codex home prepareCodexAgentHome set up. */
  codexHome: string;
  /** Unset, Codex runs its default model: Codex ignores an agent's `model:` pin. */
  codexModel?: string;
  /** Codex's `--sandbox` for the plugin reads that really run; defaults to read-only. */
  sandbox?: string;
  /** Extra `-c key=value` overrides for the `codex exec`, e.g. a model provider. */
  configOverrides?: string[];
}

/** What the Codex hook answers a shell call with, unless it only reads the plugin tree. */
export interface CodexScriptedBash {
  responses: ScriptedBashResponse[];
  /** The output for a command no response matches — `UNSCRIPTED_BASH_RESPONSE`. */
  unscripted: string;
}

/** One tool call the Codex hook recorded. */
export interface CodexAgentTraceEntry {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

/** One run's sandbox: a temp root holding the home directory the session sees and the repository it works in. */
export interface RunSandbox {
  root: string;
  /** Where `~` and the real home directory are redirected. */
  home: string;
  /** The session's working directory. */
  repo: string;
}

/** The sandbox as path rewriting needs it: the sandbox plus the real home it stands in for. */
export interface SandboxPathContext extends RunSandbox {
  realHome: string;
  /** Real directories that keep their paths though they sit under the real home — the plugin tree. */
  passthroughRoots: string[];
}

/** The sandbox after the run: each expected artifact's file content, or null when the file is absent. */
export interface ArtifactSnapshot {
  paths: SandboxPathContext;
  /** Keyed by `ArtifactExpectation.path` as the scenario wrote it. */
  fileContents: Record<string, string | null>;
}

/** What the tool policy needs to decide one call. */
export interface ToolPolicyContext {
  /** The sandbox, with the plugin tree among its passthrough roots. */
  paths: SandboxPathContext;
  /** The plugin tree: readable, never writable. */
  pluginRoot: string;
  /** Built-in tools the target is offered. */
  builtinTools: string[];
  /** Whether the run mounts the host-tool stubs, which a stray built-in orchestration call is pointed to. */
  hasHostStubs: boolean;
  /** Answers one Bash command, advancing its scripted sequence. */
  answerBash: (command: string) => string;
  /** Answers one AskUserQuestion call from its serialized input, advancing its scripted sequence. */
  answerQuestion: (serializedInput: string) => string;
}

/** A same-named in-process stand-in for a host tool the SDK would otherwise run unconsulted. */
export interface HostStubSpec {
  tool: ScriptedTool;
  description: string;
  /** Input fields the stub advertises, mirroring the built-in tool's. */
  shape: ZodRawShape;
}

/** A suite the runner will run: its file, loaded target, selected scenarios, and pass bar. */
export interface PlannedSuite {
  suite: ScenarioSuite;
  definition: TargetDefinition;
  scenarios: AgentScenario[];
  passThreshold: number;
}

/** A suite's results file, `scenarios/<stem>.results.json` (or `.codex.results.json`). */
export interface SuiteResults {
  suite: string;
  target: EvalTarget;
  /** The agent's name, for agent targets — the field CI's agent report reads. */
  agent?: string;
  host: EvalHost;
  model: string;
  /** The target's frontmatter pin, or null when a skill pins none. */
  modelAlias: string | null;
  runsPerScenario: number;
  passThreshold: number;
  recordedAt: string;
  scenarios: AgentScenarioReport[];
}

/** The runner's parsed command line. */
export interface EvalCliArgs {
  /** One scenario file's stem; unset, every file in the scenarios directory. */
  suite?: string;
  /** Set when the suite was named with the legacy `--agent`, which accepts agent targets only. */
  requireAgentTarget: boolean;
  runs: number;
  agentsDir: string;
  skillsDir: string;
  scenariosDir: string;
  concurrency: number;
  scenarioFilter?: string;
  /** Set to `pr`, nightly-only scenarios are dropped. */
  cadence?: ScenarioCadence;
  verbose: boolean;
  host: EvalHost;
  /** Under Codex: the model to run. Under the agent SDK: the model for skill targets. */
  model?: string;
  codexHome?: string;
  codexConfig: string[];
}
