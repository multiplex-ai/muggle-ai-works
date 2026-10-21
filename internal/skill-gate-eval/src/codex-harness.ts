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
  CODEX_UNUSED_FEATURES,
} from "./constants.js";
import { readGatePromptInputs } from "./prompt-inputs.js";
import { loadFixtures } from "./scenario.js";
import type {
  AskQuestionRecord,
  CodexGateTraceEntry,
  CodexRunOptions,
  Fixtures,
  MockCall,
  RunOptions,
  RunVerdict,
  Scenario,
} from "./types.js";
import {
  extractFirstQuestionText,
  isGateQuestion,
  matchAskQuestionAnswer,
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
    "There is no shell or file access here; the gate file the skill references is",
    "inlined below. When this gate resolves to `ask`, ask its Picker 1 question",
    "using the question text verbatim.",
    "",
    gateBody,
    "",
    "---",
    "# ENVIRONMENT NOTE",
    "This is a behavioral test harness for the muggle skills, run in Codex. The",
    "muggle MCP tools here return canned data, so the skill can complete without",
    "contacting real services. Only those tools and the question tool are",
    "available; nothing else is needed.",
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
 * The scripted pick for a turn that ended on a question, or undefined when it
 * did not end on one the scenario knows. A closing message counts as a
 * question only when it asks one, so a summary that names a use case does not
 * read as the use-case picker.
 */
function closingQuestion(message: string, scenario: Scenario): AskQuestionRecord | undefined {
  if (!message.includes("?")) return undefined;
  const answer = matchAskQuestionAnswer(message, scenario);
  if (answer === null && !isGateQuestion(message, scenario)) return undefined;
  return { question: message, answer: answer };
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
  for (const line of lines.slice(fromLine)) {
    const entry = JSON.parse(line) as CodexGateTraceEntry;
    if (entry.tool_name === CODEX_ASK_QUESTION_TOOL) {
      askQuestions.push({ question: extractFirstQuestionText(entry.tool_input), answer: entry.answer ?? null });
    } else if (entry.tool_name.startsWith(MOCK_TOOL_PREFIX)) {
      const bare = toolNames.get(entry.tool_name) ?? entry.tool_name.slice(MOCK_TOOL_PREFIX.length);
      mcpCalls.push({ tool: bare, args: entry.tool_input });
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
      const question = closingQuestion(closingMessageOf(stream), opts.scenario);
      if (!question) break;
      askQuestions.push(question);
      if (question.answer === null || !thread) break;
      stream = await takeTurn(["resume", thread, question.answer]);
    }
  } finally {
    fs.rmSync(profilePath, { force: true });
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 3 });
  }

  const gateQuestionFired = askQuestions.some((asked) => isGateQuestion(asked.question, opts.scenario));
  return verdict(opts.scenario, mcpCalls, askQuestions, gateQuestionFired);
}
