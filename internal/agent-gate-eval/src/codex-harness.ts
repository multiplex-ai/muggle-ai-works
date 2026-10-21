/**
 * Runs one agent scenario under the Codex CLI and returns the verdict the
 * agent SDK harness (harness.ts) would — both judge with verdict.ts.
 *
 * Mechanics:
 *   - One Codex home per eval process, which the eval owns
 *     (prepareCodexAgentHome), with codex-agent-hook.mjs as a PreToolUse hook on
 *     every tool and the Codex tools no agent SDK run has switched off.
 *   - Per rep, a config profile of its own carries the agent's definition and an
 *     environment note as developer instructions — the agent SDK harness's
 *     system prompt — and, when the scenario has fixtures, the mock muggle tools
 *     as a stdio MCP server named `muggle`.
 *   - The hook records every call and decides it: a shell read of the plugin
 *     tree runs, as the agent SDK harness's plugin-scoped Read does; every other
 *     shell call is blocked with its scripted output; a mock muggle call runs;
 *     request_user_input is denied and counted, since there is no user.
 *   - Codex ignores an agent's `model:` pin, so a rep runs Codex's default model
 *     unless one is named.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MOCK_TOOL_PREFIX,
  closingMessageOf,
  codexEvents,
  mockMcpServerToml,
  mockToolNamesByCodexName,
  runCodexTurn,
  throwIfTurnFailed,
  tomlString,
  writeEvalCodexConfig,
  writeEvalPreToolUseHook,
} from "../../skill-gate-eval/src/codex-cli.js";
import { CODEX_UNUSED_FEATURES } from "../../skill-gate-eval/src/constants.js";
import {
  CODEX_AGENT_BASH_ENV,
  CODEX_AGENT_READ_ROOT_ENV,
  CODEX_AGENT_TRACE_ENV,
  CODEX_ASK_QUESTION_TOOL,
  DEFAULT_CODEX_AGENT_SANDBOX,
} from "./constants.js";
import { UNSCRIPTED_BASH_RESPONSE } from "./harness.js";
import type {
  AgentRunOptions,
  AgentRunVerdict,
  CodexAgentRunOptions,
  CodexAgentTraceEntry,
  CodexScriptedBash,
  ToolAttempt,
} from "./types.js";
import { judgeAgentRun } from "./verdict.js";

const AGENT_HOOK = fileURLToPath(new URL("./codex-agent-hook.mjs", import.meta.url));

/** The plugin tree a definition sits in: `plugin/` for `plugin/agents/<name>.md`. */
export function pluginTreeOf(definitionPath: string): string {
  return path.dirname(path.dirname(path.resolve(definitionPath)));
}

/**
 * The developer instructions a Codex rep gets: the agent's definition and the
 * agent SDK harness's environment note, told for Codex — reads and commands go
 * through the shell, and the hook is what answers them.
 */
export function buildCodexAgentInstructions(opts: AgentRunOptions): string {
  const lines = [
    opts.definition.body,
    "",
    "---",
    "# ENVIRONMENT NOTE (behavioral test harness)",
    `Your definition file lives at ${opts.definition.filePath}; resolve its`,
    "relative markdown links from that location, reading each file with a",
    "plain shell command that names its absolute path (`cat <path>`).",
    "",
    "Other shell commands do not execute here. Every one is intercepted, and the",
    "hook message that blocks it carries that command's REAL observed output for",
    "this environment (marked SIMULATED OUTPUT). Treat it exactly as if the",
    "command ran and printed it; do not re-run a command whose output you",
    "already have.",
    "",
    "There is no user. Follow your no-user-channel contract: a missing decision",
    "or input means returning a single `needs-input:` line, never a question.",
  ];
  if (opts.scenario.fixtures) {
    lines.push(
      "",
      "The muggle MCP tools here return canned results, so you can run and",
      "report without auth, cloud, or a real browser.",
    );
  }
  return lines.join("\n");
}

/**
 * Make `codexHome` the agent eval's Codex home.
 *
 * @throws when `codexHome` holds a config.toml the eval did not write.
 */
export function prepareCodexAgentHome(codexHome: string): void {
  writeEvalCodexConfig(codexHome, [
    `web_search = "disabled"`,
    "",
    "[features]",
    ...CODEX_UNUSED_FEATURES.map((feature) => `${feature} = false`),
    "",
    "[analytics]",
    "enabled = false",
  ]);
  writeEvalPreToolUseHook(codexHome, AGENT_HOOK, "Installed by the muggle agent-gate eval: records and decides every tool call.");
}

/** The tool attempts the hook recorded, named as the agent SDK harness names them, and how many asked the user. */
export function readCodexAgentTrace(
  tracePath: string,
  toolNames: Map<string, string>,
): { toolAttempts: ToolAttempt[]; askQuestionCount: number } {
  const lines = fs.existsSync(tracePath)
    ? fs.readFileSync(tracePath, "utf8").split("\n").filter((line) => line.trim())
    : [];
  const toolAttempts: ToolAttempt[] = [];
  let askQuestionCount = 0;
  for (const line of lines) {
    const entry = JSON.parse(line) as CodexAgentTraceEntry;
    if (entry.tool_name === CODEX_ASK_QUESTION_TOOL) askQuestionCount++;
    const tool = entry.tool_name.startsWith(MOCK_TOOL_PREFIX)
      ? (toolNames.get(entry.tool_name) ?? entry.tool_name.slice(MOCK_TOOL_PREFIX.length))
      : entry.tool_name;
    toolAttempts.push({ tool: tool, args: entry.tool_input });
  }
  return { toolAttempts: toolAttempts, askQuestionCount: askQuestionCount };
}

/** Run one scenario once under Codex and return a verdict. Caller invokes this N times to compute a pass rate. */
export async function runAgentScenarioOnceInCodex(
  opts: CodexAgentRunOptions,
  onEvent?: (event: unknown) => void,
): Promise<AgentRunVerdict> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-agent-eval-work-"));
  const profile = `agent-eval-${randomUUID()}`;
  const profilePath = path.join(opts.codexHome, `${profile}.config.toml`);
  const tracePath = path.join(workspace, "trace.jsonl");
  const scriptedPath = path.join(workspace, "scripted-bash.json");
  const fixtures = opts.scenario.fixtures;
  const profileLines = [`developer_instructions = ${tomlString(buildCodexAgentInstructions(opts))}`];
  if (fixtures) {
    const fixturesPath = path.join(workspace, "fixtures.json");
    fs.writeFileSync(fixturesPath, JSON.stringify(fixtures));
    profileLines.push("", ...mockMcpServerToml(fixturesPath));
  }
  fs.writeFileSync(profilePath, `${profileLines.join("\n")}\n`);
  const scripted: CodexScriptedBash = { responses: opts.scenario.bashResponses ?? [], unscripted: UNSCRIPTED_BASH_RESPONSE };
  fs.writeFileSync(scriptedPath, JSON.stringify(scripted));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_HOME: opts.codexHome,
    [CODEX_AGENT_TRACE_ENV]: tracePath,
    [CODEX_AGENT_BASH_ENV]: scriptedPath,
    [CODEX_AGENT_READ_ROOT_ENV]: pluginTreeOf(opts.definition.filePath),
  };
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ephemeral",
    "--dangerously-bypass-hook-trust",
    "--sandbox",
    opts.sandbox ?? DEFAULT_CODEX_AGENT_SANDBOX,
    "--profile",
    profile,
    ...(opts.codexModel ? ["--model", opts.codexModel] : []),
    ...(opts.configOverrides ?? []).flatMap((override) => ["-c", override]),
    opts.scenario.prompt,
  ];

  try {
    const turn = await runCodexTurn(args, workspace, env);
    for (const event of codexEvents(turn.stdout)) onEvent?.(event);
    throwIfTurnFailed(turn);
    const { toolAttempts, askQuestionCount } = readCodexAgentTrace(tracePath, mockToolNamesByCodexName(fixtures ?? {}));
    return judgeAgentRun(opts.scenario, closingMessageOf(turn.stdout), toolAttempts, askQuestionCount);
  } finally {
    fs.rmSync(profilePath, { force: true });
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 3 });
  }
}
