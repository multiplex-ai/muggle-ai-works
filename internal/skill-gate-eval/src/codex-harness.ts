/**
 * Runs one scenario under the Codex CLI and returns the verdict the agent SDK
 * harness (harness.ts) would — both judge their trace with verdict.ts.
 *
 * Mechanics:
 *   - One Codex home per scenario file, which the eval owns
 *     (prepareCodexGateHome): the shell and the other built-in tools switched
 *     off, the mock muggle tools served over stdio (mock-mcp-stdio.ts) as a
 *     required `muggle` MCP server whose calls need no approval, and
 *     codex-gate-hook.mjs as a PreToolUse hook on every tool.
 *   - Per run: the skill, its gate contract and the synthesized SessionStart
 *     context go in as developer instructions, through a config profile of the
 *     rep's own. The hook records every call and decides it: a mock muggle call
 *     runs, `request_user_input` is answered with the scenario's scripted pick,
 *     anything else is denied.
 *   - Where Codex does not offer its question tool, a skill asks by ending its
 *     turn on the question (plugin/skills/_shared/host-tool-equivalents.md). A
 *     turn that ends that way is answered by resuming the thread with the
 *     scripted pick, as the user would.
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
  threadIdOf,
  throwIfTurnFailed,
  tomlString,
  writeEvalCodexConfig,
  writeEvalPreToolUseHook,
} from "./codex-cli.js";
import {
  CODEX_ASK_QUESTION_TOOL,
  CODEX_GATE_ANSWERS_ENV,
  CODEX_GATE_TRACE_ENV,
  CODEX_MAX_RESUMES,
  CODEX_TURN_END_EVENT,
  CODEX_UNUSED_FEATURES,
  NUMBERED_OPTION_LINE,
  UNAVAILABLE_STEPS_NOTE,
} from "./constants.js";
import { askGateContractsSection, readGatePromptInputs } from "./prompt-inputs.js";
import { loadFixtures } from "./scenario.js";
import type {
  AskQuestionRecord,
  ClosingMessageAnswers,
  CodexGateTraceEntry,
  CodexRunOptions,
  Fixtures,
  MockCall,
  RunOptions,
  RunVerdict,
  Scenario,
  ScriptedAnswer,
} from "./types.js";
import {
  extractFirstQuestionText,
  isGateQuestion,
  verdict,
} from "./verdict.js";

const GATE_HOOK = fileURLToPath(new URL("./codex-gate-hook.mjs", import.meta.url));
const HOST_TOOL_EQUIVALENTS = path.join("_shared", "host-tool-equivalents.md");

/**
 * What Codex should do where a skill says AskUserQuestion — the `In Codex`
 * cell of that row in the skills' host-tool-equivalents table, which is what a
 * Codex user's session is pointed at.
 *
 * @throws when the table has no AskUserQuestion row: the prompt would otherwise
 * leave Codex no instruction for the one thing every gate does.
 */
export function codexQuestionGuidance(skillsDir: string): string {
  const table = fs.readFileSync(path.join(skillsDir, HOST_TOOL_EQUIVALENTS), "utf8");
  const row = table.split(/\r?\n/).find((line) => line.startsWith("| `AskUserQuestion` |"));
  const inCodex = row?.split("|").map((cell) => cell.trim())[3];
  if (!inCodex) {
    throw new Error(`no AskUserQuestion row with a Codex column in ${path.join(skillsDir, HOST_TOOL_EQUIVALENTS)}`);
  }
  return inCodex;
}

/**
 * The developer instructions a Codex run gets: the same skill, gate contract
 * and session context as the agent SDK prompt (harness.ts `buildSystemPrompt`),
 * with notes for Codex in place of the agent SDK's.
 *
 * Output shape (one string, lines joined with `\n`):
 *
 *     <full SKILL.md body>
 *
 *     ---
 *     # Synthesized SessionStart context (test harness)
 *     Muggle Test Preferences: showElectronBrowser=ask …
 *     …
 *     # Preference gate contract — preference-gates/showElectronBrowser.md
 *     …
 *     # ENVIRONMENT NOTE
 *     …
 */
export function buildCodexInstructions(opts: Pick<RunOptions, "skillsDir" | "scenarioFile" | "scenario">): string {
  const { skillBody, gateBody, askGateBodies, prefs, extraContext } = readGatePromptInputs(opts);
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
    "There is no shell or file access here; the gate file the skill references is",
    "inlined below. When this gate resolves to `ask`, ask its Picker 1 question",
    "using the question text verbatim.",
    "",
    gateBody,
    askGateContractsSection(askGateBodies),
    "",
    "---",
    "# ENVIRONMENT NOTE",
    "This is a behavioral test harness for the muggle skills, run in Codex. The",
    "muggle MCP tools here return canned data, so the skill can complete without",
    "contacting real services. Only those tools and the question tool are",
    "available; nothing else is needed.",
    UNAVAILABLE_STEPS_NOTE,
    `Where the skill says AskUserQuestion: ${codexQuestionGuidance(opts.skillsDir)}`,
  ].join("\n");
}

/**
 * Make `codexHome` the eval's Codex home for one scenario file's fixtures.
 *
 * @throws when `codexHome` holds a config.toml the eval did not write.
 */
export function prepareCodexGateHome(codexHome: string, fixtures: Fixtures): void {
  const fixturesPath = path.join(codexHome, "gate-eval-fixtures.json");
  writeEvalCodexConfig(codexHome, [
    `web_search = "disabled"`,
    "",
    "[features]",
    // No shell either: the agent SDK harness offers the skill none.
    ...["shell_tool", ...CODEX_UNUSED_FEATURES].map((feature) => `${feature} = false`),
    "",
    ...mockMcpServerToml(fixturesPath),
    "",
    "[analytics]",
    "enabled = false",
  ]);
  fs.writeFileSync(fixturesPath, JSON.stringify(fixtures));
  writeEvalPreToolUseHook(codexHome, GATE_HOOK, "Installed by the muggle skill-gate eval: records and decides every tool call.");
}

/**
 * Whether a closing message without a question mark still asks for `answer`:
 * it lists `answer` as a numbered option — the shape host-tool-equivalents.md
 * tells Codex to ask in, which Codex often heads with "Pick the use case:"
 * rather than a question.
 */
function isOfferingAsOption(message: string, answer: string): boolean {
  return message.split(/\r?\n/).some((line) => NUMBERED_OPTION_LINE.test(line) && line.includes(answer));
}

/**
 * The scripted answers whose question a closing message asks: the topic sits
 * on a line that asks, or the answer is offered as a numbered option. A topic
 * the message only mentions — a recap of an earlier pick, a quote of the skill
 * — is not asked, and answering it sends the run back to a question it has
 * already had answered.
 */
function askedScriptedAnswers(message: string, scenario: Scenario): ScriptedAnswer[] {
  const lines = message.split(/\r?\n/);
  return (scenario.askQuestionAnswers ?? []).filter((scripted) =>
    lines.some((line) => line.includes("?") && line.includes(scripted.questionContains))
    || isOfferingAsOption(message, scripted.answer));
}

/**
 * The single scripted pick for a message that asks in a shape
 * `askedScriptedAnswers` does not read: its topic on one line, the question
 * mark on another, no numbered options.
 */
function looselyAskedScriptedAnswer(message: string, scenario: Scenario): ScriptedAnswer | undefined {
  if (!message.includes("?")) return undefined;
  return (scenario.askQuestionAnswers ?? []).find((scripted) => message.includes(scripted.questionContains));
}

/**
 * Answer a turn that ended on questions asked in prose: a record per question
 * the message asks, all sharing `sequence`, and the reply the thread is
 * resumed with. With questions frontloaded Codex asks several at once, so
 * every one asked is answered — a lone answer is the pick itself, several are
 * each set beside their topic.
 *
 * Output shape: `{ records: [{ question: "<message>", answer: "Open the dashboard", sequence: 3.5 }, …],
 * reply: "test case: Successful signup with valid email\nOpen the test results: Open the dashboard" }`
 */
export function answerClosingMessage(message: string, scenario: Scenario, sequence: number): ClosingMessageAnswers {
  const asked = askedScriptedAnswers(message, scenario);
  const looselyAsked = asked.length === 0 ? looselyAskedScriptedAnswer(message, scenario) : undefined;
  const answered = looselyAsked ? [looselyAsked] : asked;
  if (answered.length === 0) {
    // The gate's own question may be scripted no answer; it is still the gate firing.
    const isUnansweredGateQuestion = message.includes("?") && isGateQuestion(message, scenario);
    return {
      records: isUnansweredGateQuestion ? [{ question: message, answer: null, sequence: sequence }] : [],
      reply: null,
    };
  }
  return {
    records: answered.map((scripted) => ({ question: message, answer: scripted.answer, sequence: sequence })),
    reply: answered.length === 1
      ? answered[0].answer
      : answered.map((scripted) => `${scripted.questionContains}: ${scripted.answer}`).join("\n"),
  };
}

/** The calls the hook recorded since `fromLine`, read as the agent SDK harness records its own. */
export function readCodexGateTrace(
  tracePath: string,
  fromLine: number,
  toolNames: Map<string, string>,
): { entries: number; mcpCalls: MockCall[]; askQuestions: AskQuestionRecord[] } {
  const lines = fs.existsSync(tracePath)
    ? fs.readFileSync(tracePath, "utf8").split("\n").filter((line) => line.trim())
    : [];
  const mcpCalls: MockCall[] = [];
  const askQuestions: AskQuestionRecord[] = [];
  for (let lineIndex = fromLine; lineIndex < lines.length; lineIndex++) {
    const entry = JSON.parse(lines[lineIndex]) as CodexGateTraceEntry;
    if (entry.tool_name === CODEX_ASK_QUESTION_TOOL) {
      askQuestions.push({
        question: extractFirstQuestionText(entry.tool_input),
        answer: entry.answer ?? null,
        sequence: lineIndex,
      });
    } else if (entry.tool_name.startsWith(MOCK_TOOL_PREFIX)) {
      const bare = toolNames.get(entry.tool_name) ?? entry.tool_name.slice(MOCK_TOOL_PREFIX.length);
      mcpCalls.push({ tool: bare, args: entry.tool_input, sequence: lineIndex });
    }
  }
  return { entries: lines.length, mcpCalls: mcpCalls, askQuestions: askQuestions };
}

/** Run one scenario once under Codex and return a verdict. Caller invokes this N times to compute a pass rate. */
export async function runScenarioOnceInCodex(
  opts: CodexRunOptions,
  onEvent?: (event: unknown) => void,
): Promise<RunVerdict> {
  const fixtures = loadFixtures(opts.scenarioFilePath, opts.scenarioFile.fixturesPath) as Fixtures;
  const toolNames = mockToolNamesByCodexName(fixtures);
  const rep = randomUUID();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-gate-eval-work-"));
  const profile = `gate-eval-${rep}`;
  const profilePath = path.join(opts.codexHome, `${profile}.config.toml`);
  const tracePath = path.join(workspace, "trace.jsonl");
  const answersPath = path.join(workspace, "answers.json");
  fs.writeFileSync(profilePath, `developer_instructions = ${tomlString(buildCodexInstructions(opts))}\n`);
  fs.writeFileSync(answersPath, JSON.stringify(opts.scenario.askQuestionAnswers ?? []));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CODEX_HOME: opts.codexHome,
    [CODEX_GATE_TRACE_ENV]: tracePath,
    [CODEX_GATE_ANSWERS_ENV]: answersPath,
  };
  const flags = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--dangerously-bypass-hook-trust",
    "--sandbox",
    "read-only",
    "--profile",
    profile,
    ...(opts.model ? ["--model", opts.model] : []),
    ...(opts.configOverrides ?? []).flatMap((override) => ["-c", override]),
  ];

  const mcpCalls: MockCall[] = [];
  const askQuestions: AskQuestionRecord[] = [];
  let traced = 0;
  const takeTurn = async (args: string[]): Promise<string> => {
    const turn = await runCodexTurn([...flags, ...args], workspace, env);
    for (const event of codexEvents(turn.stdout)) onEvent?.(event);
    throwIfTurnFailed(turn);
    const recorded = readCodexGateTrace(tracePath, traced, toolNames);
    traced = recorded.entries;
    mcpCalls.push(...recorded.mcpCalls);
    askQuestions.push(...recorded.askQuestions);
    return turn.stdout;
  };

  try {
    let stream = await takeTurn([opts.scenario.userPrompt]);
    const thread = threadIdOf(stream);
    for (let resumes = 0; resumes < CODEX_MAX_RESUMES; resumes++) {
      // A turn's closing question comes after every call that turn traced and before the next turn's first.
      const closingMessage = closingMessageOf(stream);
      const answered = answerClosingMessage(closingMessage, opts.scenario, traced - 0.5);
      onEvent?.({ type: CODEX_TURN_END_EVENT, closingMessage: closingMessage, reply: answered.reply });
      askQuestions.push(...answered.records);
      if (answered.reply === null || !thread) break;
      stream = await takeTurn(["resume", thread, answered.reply]);
    }
  } finally {
    fs.rmSync(profilePath, { force: true });
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 3 });
  }

  const gateQuestionFired = askQuestions.some((asked) => isGateQuestion(asked.question, opts.scenario));
  return verdict(opts.scenario, mcpCalls, askQuestions, gateQuestionFired);
}
