/**
 * Runs one scenario end-to-end under the agent SDK and returns a per-run verdict.
 *
 * Mechanics:
 *   - Every run gets a sandbox (sandbox/sandbox.ts): a temp home and a repo,
 *     optionally a copy of a fixture repository, seeded with the scenario's
 *     files. The repo is the session's working directory; `~` and the real home
 *     directory are redirected into the sandbox home.
 *   - Agent targets: the agent's `plugin/agents/<name>.md` body is the system
 *     prompt, run on the model its frontmatter pins — the pin surviving on a
 *     cheaper/different model IS the contract under test.
 *   - Skill targets: the session runs on Claude Code's own system prompt plus a
 *     synthesized SessionStart preferences block, and the first user message
 *     is the skill's invocation, built as the Skill tool injects it.
 *   - One policy (tools/policy.ts) decides every tool call, applied in a
 *     PreToolUse hook and again in canUseTool: Read is real within the plugin
 *     tree and the sandbox, so a broken stage link fails behaviorally; Write
 *     and Edit are real within the sandbox; Bash never executes and answers
 *     with the scenario's scripted output; AskUserQuestion is denied with a
 *     scripted answer or "there is no user".
 *   - Muggle MCP is mocked (tools/sequenced-mock-mcp.ts) for skill targets and
 *     for agent scenarios that declare `fixtures`, so a run completes without
 *     auth, cloud, or Electron.
 *   - Skill targets get same-named stand-ins for Skill, Agent, TodoWrite,
 *     CronCreate, CronDelete and Monitor (tools/host-stubs.ts), answered from
 *     the scenario's `toolResponses`; nothing they name runs.
 *   - Tool attempts are recorded from the model's own tool_use blocks
 *     (tools/trace.ts), in call order.
 *   - A scenario with `seed.transcript` resumes from those prior turns
 *     (transcript/resume.ts) instead of starting at the invocation.
 */

import {
  query,
  type CanUseTool,
  type HookCallback,
  type McpServerConfig,
  type PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";

import {
  AGENT_BUILTIN_TOOLS,
  DEFAULT_MAX_TURNS,
  HOST_STUB_PREFIX,
  HOST_STUB_SERVER_NAME,
  HOST_STUB_SPECS,
  MOCK_MCP_NOTE_LINES,
  MOCK_MCP_SERVER_NAME,
  SCRIPTED_BASH_NOTE_LINES,
  SKILL_BUILTIN_TOOLS,
} from "./constants.js";
import { fillSandboxPathTokens } from "./sandbox/paths.js";
import { createRunSandbox, removeRunSandbox, sandboxPathContext, snapshotArtifacts } from "./sandbox/sandbox.js";
import { buildPreferencesContext } from "./session-context.js";
import { buildSkillInvocationMessage } from "./skill-definition.js";
import { pluginRootOf } from "./target-definition.js";
import { buildHostStubServer } from "./tools/host-stubs.js";
import { decideToolUse, toPreToolUseOutput } from "./tools/policy.js";
import { createBashResponder, createToolResponder } from "./tools/scripted-replies.js";
import { buildSequencedMockMcpServer, createMockToolAnswerer } from "./tools/sequenced-mock-mcp.js";
import { toolAttemptsInMessage } from "./tools/trace.js";
import { resumeFromSeedTranscript } from "./transcript/resume.js";
import {
  EvalTargetKind,
  ScriptedTool,
  type AgentDefinition,
  type AgentRunOptions,
  type AgentRunVerdict,
  type AgentScenario,
  type RunUsage,
  type SandboxPathContext,
  type SkillDefinition,
  type ToolAttempt,
  type ToolPolicyContext,
} from "./types.js";
import { judgeAgentRun } from "./verdict.js";

/** The run's spend as the SDK's terminal `result` message reports it, or undefined when a field is missing. */
function runUsageOf(resultMessage: unknown): RunUsage | undefined {
  const { total_cost_usd: costUsd, duration_ms: durationMs, num_turns: turns } = (resultMessage ?? {}) as {
    total_cost_usd?: unknown;
    duration_ms?: unknown;
    num_turns?: unknown;
  };
  if (typeof costUsd !== "number" || typeof durationMs !== "number" || typeof turns !== "number") return undefined;
  return { costUsd: costUsd, durationMs: durationMs, turns: turns };
}

/** The system prompt an agent target runs under: its definition body plus the environment note. */
export function buildAgentSystemPrompt(definition: AgentDefinition, scenario: AgentScenario): string {
  const lines = [
    definition.body,
    "",
    "---",
    "# ENVIRONMENT NOTE (behavioral test harness)",
    `Your definition file lives at ${definition.filePath}; resolve its`,
    "relative markdown links from that location using the Read tool.",
    "",
    ...SCRIPTED_BASH_NOTE_LINES,
    "",
    "There is no user. Follow your no-user-channel contract: a missing decision",
    "or input means returning a single `needs-input:` line, never a question.",
  ];
  if (scenario.fixtures) lines.push("", ...MOCK_MCP_NOTE_LINES);
  return lines.join("\n");
}

/**
 * What a skill target's session appends to Claude Code's system prompt: the
 * synthesized SessionStart context, then the environment note.
 */
export function buildSkillSystemPromptAppend(
  scenario: AgentScenario,
  paths: SandboxPathContext,
  pluginRoot: string,
): string {
  const stubNames = HOST_STUB_SPECS.map((spec) => spec.tool).join(", ");
  return [
    "# Synthesized SessionStart context (test harness)",
    buildPreferencesContext(pluginRoot, scenario.preferences),
    "",
    "---",
    "# ENVIRONMENT NOTE (behavioral test harness)",
    ...SCRIPTED_BASH_NOTE_LINES,
    "",
    `Your home directory (\`~\`) is ${paths.home}; the repository you work in is`,
    `${paths.repo}, the working directory. Read, Write and Edit work anywhere under`,
    `${paths.root}. Read also opens the plugin tree at ${pluginRoot}, which is read-only.`,
    "",
    `The ${stubNames} tools are served here as \`${HOST_STUB_PREFIX}<name>\``,
    `(e.g. \`${HOST_STUB_PREFIX}${ScriptedTool.Skill}\`); call those wherever your instructions name`,
    "the tool. What they return is this environment's real result.",
    "",
    ...MOCK_MCP_NOTE_LINES,
  ].join("\n");
}

function invocationPrompt(definition: AgentDefinition | SkillDefinition, scenario: AgentScenario): string {
  return definition.kind === EvalTargetKind.Skill
    ? buildSkillInvocationMessage(definition, scenario.prompt)
    : scenario.prompt;
}

/** Run one scenario once and return a verdict. Caller invokes this N times to compute a pass rate. */
export async function runAgentScenarioOnce(
  opts: AgentRunOptions,
  onMessage?: (msg: unknown) => void,
): Promise<AgentRunVerdict> {
  const { definition, scenario } = opts;
  const isSkillTarget = definition.kind === EvalTargetKind.Skill;
  const pluginRoot = pluginRootOf(definition);
  const sandbox = createRunSandbox(scenario.seed);
  try {
    const paths = sandboxPathContext(sandbox, [pluginRoot]);
    const answerScriptedTool = createToolResponder(scenario.toolResponses);
    const answerTool = (tool: ScriptedTool, serializedInput: string): string =>
      fillSandboxPathTokens(answerScriptedTool(tool, serializedInput), sandbox);
    const answerScriptedBash = createBashResponder(scenario.bashResponses);
    const builtinTools = isSkillTarget ? SKILL_BUILTIN_TOOLS : AGENT_BUILTIN_TOOLS;
    const policyContext: ToolPolicyContext = {
      paths: paths,
      pluginRoot: pluginRoot,
      builtinTools: builtinTools,
      hasHostStubs: isSkillTarget,
      answerBash: (command) => fillSandboxPathTokens(answerScriptedBash(command), sandbox),
      answerQuestion: (serializedInput) => answerTool(ScriptedTool.AskUserQuestion, serializedInput),
    };

    // The hook is the gate: it fires for every call that passes input validation,
    // including calls the SDK would allow without asking canUseTool.
    const enforcePolicy: HookCallback = async (hookInput) => {
      const { tool_name, tool_input } = hookInput as PreToolUseHookInput;
      return toPreToolUseOutput(
        decideToolUse(tool_name, (tool_input ?? {}) as Record<string, unknown>, policyContext),
      );
    };
    const canUseTool: CanUseTool = async (toolName, input) => decideToolUse(toolName, input, policyContext);

    const mcpServers: Record<string, McpServerConfig> = {};
    if (isSkillTarget || scenario.fixtures) {
      mcpServers[MOCK_MCP_SERVER_NAME] = buildSequencedMockMcpServer(scenario.fixtures ?? {}).config;
    }
    if (isSkillTarget) mcpServers[HOST_STUB_SERVER_NAME] = buildHostStubServer(answerTool);

    const firstUserMessage = invocationPrompt(definition, scenario);
    const transcript = scenario.seed?.transcript;
    // The transcript gets responders of its own, so its calls leave the live run's sequences unadvanced.
    const answerSeedTool = createToolResponder(scenario.toolResponses);
    const resume = transcript
      ? resumeFromSeedTranscript({
          transcript: transcript,
          firstUserMessage: firstUserMessage,
          model: definition.model,
          context: {
            paths: paths,
            pluginRoot: pluginRoot,
            answerBash: createBashResponder(scenario.bashResponses),
            answerTool: (tool, serializedInput) =>
              fillSandboxPathTokens(answerSeedTool(tool, serializedInput), sandbox),
            answerMockTool: createMockToolAnswerer(scenario.fixtures ?? {}),
          },
        })
      : undefined;

    const stream = query({
      prompt: resume ? resume.prompt : firstUserMessage,
      options: {
        // Judge the target on its own definition, nothing else. Omitting this loads every
        // filesystem settings source, and this repo's .claude/settings.json enables the
        // muggle plugin — whose Stop guardrails then fire inside the eval and replace the
        // final report with a reply to the guardrail.
        settingSources: [],
        // Without it the account's claude.ai connectors join the run's tools.
        strictMcpConfig: true,
        ...(resume ? resume.queryOptions : { persistSession: false }),
        cwd: sandbox.repo,
        systemPrompt: isSkillTarget
          ? { type: "preset", preset: "claude_code", append: buildSkillSystemPromptAppend(scenario, paths, pluginRoot) }
          : buildAgentSystemPrompt(definition, scenario),
        canUseTool: canUseTool,
        hooks: { PreToolUse: [{ hooks: [enforcePolicy] }] },
        model: definition.model,
        maxTurns: opts.maxTurns ?? scenario.maxTurns ?? DEFAULT_MAX_TURNS,
        tools: builtinTools,
        ...(Object.keys(mcpServers).length > 0 ? { mcpServers: mcpServers } : {}),
        ...(process.env.CLAUDE_CODE_EXECUTABLE
          ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE }
          : {}),
        stderr: (chunk: string) => process.stderr.write(chunk),
      },
    });

    // Drain the stream; the terminal `result` message carries the final report.
    // Keep the last assistant text as a fallback when the run ends without a
    // success result (e.g. max-turns).
    const toolAttempts: ToolAttempt[] = [];
    let finalOutput = "";
    let lastAssistantText = "";
    let lastResult: unknown = null;
    try {
      for await (const msg of stream) {
        if (onMessage) onMessage(msg);
        toolAttempts.push(...toolAttemptsInMessage(msg));
        const typed = msg as {
          type?: string;
          result?: unknown;
          message?: { content?: Array<{ type?: string; text?: string }> };
        };
        if (typed.type === "result") {
          lastResult = msg;
          if (typeof typed.result === "string") finalOutput = typed.result;
        }
        if (typed.type === "assistant") {
          const textBlocks = (typed.message?.content ?? [])
            .filter((b) => b.type === "text" && typeof b.text === "string")
            .map((b) => b.text as string);
          if (textBlocks.length > 0) lastAssistantText = textBlocks.join("\n");
        }
      }
    } catch (err) {
      if (lastResult !== null) {
        process.stderr.write(
          `[agent-gate-eval] final SDK message before failure: ${JSON.stringify(lastResult)}\n`,
        );
      }
      throw err;
    }

    if (!finalOutput) finalOutput = lastAssistantText;
    const askQuestionCount = toolAttempts.filter((attempt) => attempt.tool === ScriptedTool.AskUserQuestion).length;
    const artifactSnapshot = snapshotArtifacts(scenario.expect.requireArtifacts ?? [], paths);
    const verdict = judgeAgentRun(scenario, finalOutput, toolAttempts, askQuestionCount, artifactSnapshot);
    const usage = runUsageOf(lastResult);
    return usage ? { ...verdict, usage: usage } : verdict;
  } finally {
    removeRunSandbox(sandbox);
  }
}
