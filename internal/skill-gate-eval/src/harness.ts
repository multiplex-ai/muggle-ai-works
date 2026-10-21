/**
 * Runs one scenario end-to-end and returns a per-run verdict.
 *
 * Mechanics:
 *   - Loads the target SKILL.md as the system prompt + a synthesized
 *     SessionStart context block (preferences, last-project, last-host).
 *   - Mounts the in-process mock muggle MCP server via the agent SDK's
 *     `mcpServers` option.
 *   - Hooks `canUseTool` to record every tool call. Mock muggle tools
 *     are allowed (the SDK then runs the canned handler). AskQuestion
 *     is denied with a scripted user-selection message — the deny
 *     channel is what feeds the agent its "answer."
 *   - Iterates the SDK query stream to completion, then asserts the
 *     captured trace against the scenario's `expect` block.
 */

import {
  query,
  type CanUseTool,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";

import { ASK_QUESTION_TOOL } from "./constants.js";
import { buildMockMcpServer } from "./mock-mcp.js";
import { readGatePromptInputs } from "./prompt-inputs.js";
import { loadFixtures } from "./scenario.js";
import type {
  AskQuestionRecord,
  Fixtures,
  MockCall,
  RunOptions,
  RunVerdict,
} from "./types.js";
import {
  extractFirstQuestionText,
  isGateQuestion,
  matchAskQuestionAnswer,
  verdict,
} from "./verdict.js";

const DEFAULT_MAX_TURNS = 40;
const MOCK_MCP_PREFIX = "mcp__eval_mock__";
const PRODUCTION_MUGGLE_PREFIX = "mcp__plugin_muggle_muggle__";

/**
 * Build the system prompt from the SKILL.md plus a synthesized
 * SessionStart context block.
 *
 * Output shape (one string, lines joined with `\n`):
 *
 *     <full SKILL.md body>
 *
 *     ---
 *     # Synthesized SessionStart context (test harness)
 *     Muggle Test Preferences: showElectronBrowser=always autoLogin=always ...
 *     Muggle Test Last Project: id=proj-stub-1 url=http://localhost:3000 ...
 *     Muggle Test Last Host: http://localhost:3000
 */
export function buildSystemPrompt(opts: RunOptions): string {
  const { skillBody, gateBody, prefs, extraContext } = readGatePromptInputs(opts);
  return [
    skillBody,
    "",
    "---",
    "# Synthesized SessionStart context (test harness)",
    `Muggle Test Preferences: ${prefs}`,
    extraContext,
    "",
    "---",
    `# Preference gate contract — preference-gates/${opts.scenarioFile.gate}.md`,
    "The Read tool is unavailable here; the gate file the skill references is",
    "inlined below. When this gate resolves to `ask`, fire its Picker 1 via",
    "AskUserQuestion using the question text verbatim.",
    "",
    gateBody,
    "",
    "---",
    "# ENVIRONMENT NOTE",
    "This is a behavioral test harness for the muggle skills. The production",
    "`mcp__plugin_muggle_muggle__*` tools are NOT available — every call to",
    "them is denied. Use the matching `mcp__eval_mock__*` tools instead;",
    "they return canned data so the skill can complete without contacting",
    "real services. The skill text refers to bare tool names (e.g.",
    "`muggle-local-execute-test-generation`); resolve those to",
    "`mcp__eval_mock__muggle-local-execute-test-generation` and so on.",
  ].join("\n");
}

/**
 * Strip the mock MCP prefix from a recorded tool name so the verdict
 * can match against the bare names used in scenarios
 * (`muggle-local-execute-test-generation`).
 */
function bareToolName(toolName: string): string {
  if (toolName.startsWith(MOCK_MCP_PREFIX)) {
    return toolName.slice(MOCK_MCP_PREFIX.length);
  }
  return toolName;
}

/** Run one scenario once and return a verdict. Caller invokes this N times to compute a pass rate. */
export async function runScenarioOnce(
  opts: RunOptions,
  onMessage?: (msg: unknown) => void,
): Promise<RunVerdict> {
  const fixtures = loadFixtures(
    opts.scenarioFilePath,
    opts.scenarioFile.fixturesPath,
  ) as Fixtures;
  const mock = buildMockMcpServer(fixtures);

  const mcpCalls: MockCall[] = [];
  const askQuestions: AskQuestionRecord[] = [];
  let gateQuestionFired = false;

  const systemPrompt = buildSystemPrompt(opts);

  const canUseTool: CanUseTool = async (
    toolName,
    input,
  ): Promise<PermissionResult> => {
    if (toolName === ASK_QUESTION_TOOL) {
      // The agent's AskQuestion input is { questions: [{ question, options, ... }] }.
      // Extract the first question's text; that's what we match on.
      const firstQuestion = extractFirstQuestionText(input);
      if (isGateQuestion(firstQuestion, opts.scenario)) {
        gateQuestionFired = true;
      }
      const answer = matchAskQuestionAnswer(firstQuestion, opts.scenario);
      askQuestions.push({ question: firstQuestion, answer: answer });
      return {
        behavior: "deny",
        message:
          answer !== null
            ? `User selected: "${answer}"`
            : "[harness] no scripted answer for this question — scenario should add one",
      };
    }

    if (toolName.startsWith(MOCK_MCP_PREFIX)) {
      mcpCalls.push({ tool: bareToolName(toolName), args: input });
      return { behavior: "allow", updatedInput: input };
    }

    // Production muggle plugin is loaded in the parent Claude Code session
    // and bleeds into the SDK; redirect the agent to the mock equivalents.
    if (toolName.startsWith(PRODUCTION_MUGGLE_PREFIX)) {
      const bare = toolName.slice(PRODUCTION_MUGGLE_PREFIX.length);
      return {
        behavior: "deny",
        message: `[harness] the production muggle plugin is not available in this eval. Use \`${MOCK_MCP_PREFIX}${bare}\` instead.`,
      };
    }

    // Anything else (built-in Read/Bash/etc.) — deny. The skill shouldn't need them.
    return {
      behavior: "deny",
      message: `[harness] tool ${toolName} is not available in this eval — the skill should not need it`,
    };
  };

  const stream = query({
    prompt: opts.scenario.userPrompt,
    options: {
      systemPrompt: systemPrompt,
      // Judge the skill on its own definition, nothing else. Omitting this loads
      // every filesystem settings source, and this repo's .claude/settings.json
      // enables the muggle plugin — whose Stop guardrails then fire inside the
      // eval. The production-tool denial below is a second line of defence
      // against the same bleed, not a substitute for closing it here.
      settingSources: [],
      mcpServers: { eval_mock: mock.config },
      canUseTool: canUseTool,
      model: opts.model,
      maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS,
      // Disable everything except our mock MCP namespace + AskUserQuestion.
      tools: ["AskUserQuestion"],
      // In CI the SDK's bundled native binary isn't present; the workflow sets
      // CLAUDE_CODE_EXECUTABLE to the globally-installed CLI. Unset locally, so
      // the SDK falls back to its default resolution.
      ...(process.env.CLAUDE_CODE_EXECUTABLE
        ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE }
        : {}),
      // Surface the CLI's own stderr — otherwise an auth/launch failure only
      // shows as "Claude Code process exited with code 1".
      stderr: (data: string) => process.stderr.write(data),
    },
  });

  // Drain the stream so the SDK actually runs the agent to completion. Capture
  // the terminal `result` message: on an auth/launch failure the real reason
  // rides this stdout message (e.g. an is_error subtype), which the SDK then
  // collapses into an opaque "process exited with code 1" throw. Surfacing it
  // is the difference between "a token 401" and "an SDK fault" in the CI log.
  let lastResult: unknown = null;
  try {
    for await (const msg of stream) {
      if (onMessage) onMessage(msg);
      if ((msg as { type?: unknown }).type === "result") lastResult = msg;
    }
  } catch (err) {
    if (lastResult !== null) {
      process.stderr.write(
        `[skill-gate-eval] final SDK message before failure: ${JSON.stringify(lastResult)}\n`,
      );
    }
    throw err;
  }

  if ((lastResult as { is_error?: unknown } | null)?.is_error) {
    process.stderr.write(
      `[skill-gate-eval] SDK returned an error result: ${JSON.stringify(lastResult)}\n`,
    );
  }

  return verdict(opts.scenario, mcpCalls, askQuestions, gateQuestionFired);
}
