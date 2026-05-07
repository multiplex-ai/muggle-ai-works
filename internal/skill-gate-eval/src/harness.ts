/**
 * Runs one scenario end-to-end and returns a per-run verdict.
 *
 * Mechanics:
 *   - Loads the target SKILL.md as the system prompt.
 *   - Synthesizes a SessionStart context block (preferences line + any
 *     extra session-context lines from the scenario) and appends it.
 *   - Wires the mock muggle MCP server into the agent SDK.
 *   - Hooks `canUseTool` to record every tool call. AskQuestion calls
 *     get auto-answered from the scenario's `askQuestionAnswers`, or
 *     fail the scenario if the gate's question fired when it shouldn't.
 *   - After the run, asserts the captured trace against the scenario's
 *     `expect` block.
 *
 * The Claude Agent SDK API used here is the canonical TS SDK shape; if
 * the package import path or hook names diverge in the installed
 * version, adjust the imports — the structure of the harness is
 * stable.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ASK_QUESTION_TOOL } from "./constants.js";
import { buildMockMcpServer, MockCall } from "./mock-mcp.js";
import { loadFixtures } from "./scenario.js";
import type {
  AskQuestionRecord,
  RunOptions,
  RunVerdict,
  Scenario,
} from "./types.js";

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
 * Run one scenario once and return a verdict. Caller invokes this N
 * times to compute a pass rate.
 *
 * The actual agent invocation is left abstract: a real implementation
 * imports `query` from `@anthropic-ai/claude-agent-sdk`, wires
 * `mcpServers: { muggle: handle.server }` and a `canUseTool` callback
 * that records and answers AskQuestion. This file is the contract for
 * what the harness emits — fill in `runAgent` once the SDK package is
 * installed.
 */
export async function runScenarioOnce(opts: RunOptions): Promise<RunVerdict> {
  const fixtures = loadFixtures(
    opts.scenarioFilePath,
    opts.scenarioFile.fixturesPath,
  );
  const mock = buildMockMcpServer(fixtures);
  const askQuestions: AskQuestionRecord[] = [];
  let gateQuestionFired = false;

  const systemPrompt = buildSystemPrompt(opts);

  // canUseTool intercepts every tool call. For mocked muggle tools we
  // allow + the mock server records the call. For AskQuestion we
  // record + auto-answer or fail the scenario.
  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ behavior: "allow"; updatedInput?: unknown } | { behavior: "deny"; message: string }> => {
    if (toolName === ASK_QUESTION_TOOL) {
      const question = String(
        (input as { question?: unknown }).question ?? "",
      );
      if (isGateQuestion(question, opts.scenario)) gateQuestionFired = true;
      const answer = matchAskQuestionAnswer(question, opts.scenario);
      askQuestions.push({ question: question, answer: answer });
      // Returning `deny` short-circuits: the agent gets the message as
      // the tool result, which we use to inject our scripted answer.
      // Real SDK shape may differ; adjust to whatever the canUseTool
      // contract is in the installed version.
      return {
        behavior: "deny",
        message: answer ?? "[harness] no scripted answer for this question",
      };
    }
    return { behavior: "allow" };
  };

  await runAgent({
    systemPrompt: systemPrompt,
    userPrompt: opts.scenario.userPrompt,
    mcpServer: mock.server,
    canUseTool: canUseTool,
    model: opts.model,
  });

  return verdict(opts.scenario, mock.calls, askQuestions, gateQuestionFired);
}

/**
 * Stub for the real Claude Agent SDK call. Replace this body with the
 * concrete `query()` invocation from `@anthropic-ai/claude-agent-sdk`
 * once that dep is installed and pinned. Until then, calling
 * `runScenarioOnce` will throw — by design, so the harness scaffold
 * doesn't masquerade as runnable.
 */
async function runAgent(_args: {
  systemPrompt: string;
  userPrompt: string;
  mcpServer: unknown;
  canUseTool: (
    toolName: string,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  model: string;
}): Promise<void> {
  throw new Error(
    "[skill-gate-eval] runAgent not wired yet. Install @anthropic-ai/claude-agent-sdk and replace this stub. See README.",
  );
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
