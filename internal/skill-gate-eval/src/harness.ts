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

import * as fs from "node:fs";
import * as path from "node:path";

import {
  query,
  type CanUseTool,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";

import { ASK_QUESTION_TOOL } from "./constants.js";
import { buildMockMcpServer } from "./mock-mcp.js";
import { loadFixtures } from "./scenario.js";
import type {
  AskQuestionRecord,
  Fixtures,
  MockCall,
  RunOptions,
  RunVerdict,
  Scenario,
} from "./types.js";

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
function buildSystemPrompt(opts: RunOptions): string {
  const skillMdPath = path.join(
    opts.skillsDir,
    opts.scenarioFile.skill,
    "SKILL.md",
  );
  const skillBody = fs.readFileSync(skillMdPath, "utf8");
  // The Read tool is denied in this harness, so a skill that says "run
  // Picker 1 from preference-gates/<gate>.md" can't open that file the way it
  // would in production. Inline the gate-under-test's contract so the model
  // has its Picker 1 question verbatim — mirroring production's Read access.
  const gatePath = path.join(
    opts.skillsDir,
    "muggle-preferences",
    "preference-gates",
    `${opts.scenarioFile.gate}.md`,
  );
  const gateBody = fs.existsSync(gatePath)
    ? fs.readFileSync(gatePath, "utf8")
    : "";
  const prefs = Object.entries(opts.scenario.preferences)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const extraContext = (opts.scenario.sessionContext ?? []).join("\n");
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

function matchAskQuestionAnswer(
  question: string,
  scenario: Scenario,
): string | null {
  for (const a of scenario.askQuestionAnswers ?? []) {
    if (question.includes(a.questionContains)) return a.answer;
  }
  return null;
}

/**
 * Decide whether an AskQuestion call relates to the gate under test.
 * The simplest signal is `gateQuestionSubstring` — when present, an
 * AskQuestion whose text contains the substring is "the gate firing".
 */
function isGateQuestion(question: string, scenario: Scenario): boolean {
  const sub = scenario.expect.gateQuestionSubstring;
  if (!sub) return false;
  return question.includes(sub);
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

function extractFirstQuestionText(input: Record<string, unknown>): string {
  const questions = (input as { questions?: unknown }).questions;
  if (Array.isArray(questions) && questions.length > 0) {
    const q = questions[0] as { question?: unknown };
    return typeof q.question === "string" ? q.question : "";
  }
  // Fallback: some callers may pass a flat `question` field.
  const flat = (input as { question?: unknown }).question;
  return typeof flat === "string" ? flat : "";
}

function verdict(
  scenario: Scenario,
  mcpCalls: MockCall[],
  askQuestions: AskQuestionRecord[],
  gateQuestionFired: boolean,
): RunVerdict {
  const reasons: string[] = [];

  if (scenario.expect.askQuestionForGate && !gateQuestionFired) {
    reasons.push(
      `expected gate to ask Picker 1 (substring="${scenario.expect.gateQuestionSubstring}") but it never fired`,
    );
  }
  if (!scenario.expect.askQuestionForGate && gateQuestionFired) {
    reasons.push(
      `expected gate to be silent but Picker 1 fired (substring matched: "${scenario.expect.gateQuestionSubstring}")`,
    );
  }

  if (scenario.expect.executeTool) {
    const exec = mcpCalls.find((c) => c.tool === scenario.expect.executeTool);
    if (!exec) {
      reasons.push(`expected ${scenario.expect.executeTool} to be called but it was not`);
    } else if (scenario.expect.executeArgs) {
      const args = (exec.args ?? {}) as Record<string, unknown>;
      for (const [k, expected] of Object.entries(scenario.expect.executeArgs)) {
        const actualPresent = Object.prototype.hasOwnProperty.call(args, k);
        if (expected === "OMITTED") {
          if (actualPresent) {
            reasons.push(`expected ${k} to be omitted from ${exec.tool} but it was ${JSON.stringify(args[k])}`);
          }
        } else {
          if (!actualPresent) {
            reasons.push(`expected ${k}=${JSON.stringify(expected)} on ${exec.tool} but it was omitted`);
          } else if (args[k] !== expected) {
            reasons.push(`expected ${k}=${JSON.stringify(expected)} on ${exec.tool} but got ${JSON.stringify(args[k])}`);
          }
        }
      }
    }
  }

  return {
    scenario: scenario.name,
    pass: reasons.length === 0,
    reasons: reasons,
    trace: {
      mcpCalls: mcpCalls,
      askQuestions: askQuestions,
    },
  };
}
