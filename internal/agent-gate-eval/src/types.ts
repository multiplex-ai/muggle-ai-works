/**
 * Shared types for the agent-gate eval — the behavioral contract check for
 * plugin agents (`plugin/agents/*.md`) and skills (`plugin/skills/<name>/SKILL.md`).
 * Gates on the session's final report, its tool-attempt trace, and the files
 * it leaves in the run's sandbox.
 */

import type { ZodRawShape } from "zod";

import type { EvalHost, Fixtures, ScenarioReport } from "../../skill-gate-eval/src/types.js";

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

/** A canned response for an intercepted Bash command. First match wins; `commandContains: ""` is the catch-all. */
export interface ScriptedBashResponse extends ScriptedReply {
  commandContains: string;
}

/** A canned answer for a scripted tool call; `argContains` is matched against the JSON-serialized input. First match wins. */
export interface ScriptedToolResponse extends ScriptedReply {
  argContains: string;
}

/** Scripted answers per tool, for the tools the harness never runs. */
export type ScriptedToolResponses = Partial<Record<ScriptedTool, ScriptedToolResponse[]>>;

/** A mock MCP fixture slot that answers successive calls in order; the last repeats. */
export interface SequencedFixture {
  sequence: unknown[];
}

/** A tool-attempt pattern: `argContains` is matched against the JSON-serialized tool input. */
export interface ToolAttemptPattern {
  tool: string;
  argContains: string;
}

/** A file the run must leave behind: in the sandbox, or named by a recorded Write or Bash attempt. */
export interface ArtifactExpectation {
  /** `~/…` resolves in the sandbox home; a relative path resolves in the sandbox repo. */
  path: string;
  /** A substring the file, or the attempt that wrote it, must carry. */
  contains?: string;
}

/** A file written into the sandbox before the run; `~/…` lands in the sandbox home, a relative path in the repo. */
export interface SeedFile {
  path: string;
  content: string;
}

/** The sandbox's starting state. */
export interface ScenarioSeed {
  /** A directory under `fixtures/` copied in as the repository; unset, the repository starts empty. */
  repo?: string;
  files?: SeedFile[];
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
  /** Files the run must leave in the sandbox or name in a recorded Write or Bash attempt. */
  requireArtifacts?: ArtifactExpectation[];
  /**
   * The no-user-channel contract: agents never ask the user. Defaults to true;
   * a scenario can only relax it explicitly.
   */
  forbidAskUserQuestion?: boolean;
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
  /** Unset, the scenario runs on every in-scope PR. */
  cadence?: ScenarioCadence;
  expect: AgentScenarioExpectation;
}

/** A `scenarios/<stem>.json` file: one target, its scenarios, and the pass bar they share. */
export interface AgentScenarioFile {
  /** The file stem is the target's name, or starts with `<name>.` for a second suite on one target. */
  target: EvalTarget;
  /** Per-scenario pass-rate floor; unset, PASS_THRESHOLD. */
  passThreshold?: number;
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
  scenarios: ScenarioReport[];
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
