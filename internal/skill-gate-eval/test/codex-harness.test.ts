import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import {
  closingMessageOf,
  codexQuestionGuidance,
  prepareCodexGateHome,
  readCodexGateTrace,
  threadIdOf,
  turnFailureOf,
} from "../src/codex-harness.js";
import { CODEX_GATE_ANSWERS_ENV, CODEX_GATE_HOME_MARKER, CODEX_GATE_TRACE_ENV } from "../src/constants.js";
import { mockToolSpecs } from "../src/mock-tools.js";
import type { CodexGateTraceEntry, Scenario } from "../src/types.js";
import { extractFirstQuestionText, matchAskQuestionAnswer } from "../src/verdict.js";

const SKILLS_DIR = fileURLToPath(new URL("../../../plugin/skills", import.meta.url));
const GATE_HOOK = fileURLToPath(new URL("../src/codex-gate-hook.mjs", import.meta.url));

// Lines a real `codex exec --json` turn printed (codex-cli 0.163.0).
const COMPLETED_TURN = [
  '{"type":"thread.started","thread_id":"01a15bcf-9756-7190-b680-2da821932067"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation."}}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"Show the test browser while it runs?\\n1. Yes\\n2. No"}}',
  '{"type":"turn.completed","usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0}}',
].join("\n");
const RATE_LIMITED_TURN = [
  '{"type":"thread.started","thread_id":"01a15bc5-9278-7a30-8be4-c2f7eb3b8fb8"}',
  '{"type":"turn.started"}',
  '{"type":"error","message":"rate limit exceeded: Rate limit reached for mock-model on tokens per min (TPM): Limit 30000, Used 30000. Please try again in 2s."}',
  '{"type":"turn.failed","error":{"message":"rate limit exceeded: Rate limit reached for mock-model on tokens per min (TPM): Limit 30000, Used 30000. Please try again in 2s."}}',
].join("\n");

/** Run the gate hook on one PreToolUse payload; returns its decision and what it traced. */
function runHook(payload: unknown, answers: Scenario["askQuestionAnswers"]): { decision: string; traced: CodexGateTraceEntry[] } {
  const dir = mkdtempSync(join(tmpdir(), "codex-gate-hook-"));
  const trace = join(dir, "trace.jsonl");
  const answersPath = join(dir, "answers.json");
  writeFileSync(answersPath, JSON.stringify(answers ?? []));
  const run = spawnSync(process.execPath, [GATE_HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf-8",
    env: { ...process.env, [CODEX_GATE_TRACE_ENV]: trace, [CODEX_GATE_ANSWERS_ENV]: answersPath },
  });
  expect(run.status, run.stderr).toBe(0);
  const traced = readFileSync(trace, "utf-8").trim().split("\n").map((line) => JSON.parse(line) as CodexGateTraceEntry);
  return { decision: run.stdout, traced: traced };
}

function permission(decision: string): { decision?: string; reason?: string } {
  const output = (JSON.parse(decision) as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }).hookSpecificOutput;
  return { decision: output?.permissionDecision, reason: output?.permissionDecisionReason };
}

const askPayload = (question: string) => ({
  hook_event_name: "PreToolUse",
  tool_name: "request_user_input",
  tool_input: { questions: [{ id: "q", header: "h", question: question, options: [{ label: "A", description: "" }] }] },
});

describe("the Codex gate hook", () => {
  const answers = [
    { questionContains: "use case", answer: "Sign up flow" },
    { questionContains: "Show the test browser", answer: "Show it" },
  ];

  it("answers request_user_input with the scripted pick by denying it", () => {
    const { decision, traced } = runHook(askPayload("Show the test browser as it runs?"), answers);
    expect(permission(decision)).toEqual({ decision: "deny", reason: 'User selected: "Show it"' });
    expect(traced[0].answer).toBe("Show it");
  });

  it("says so when the scenario scripts no answer, and records that none was given", () => {
    const { decision, traced } = runHook(askPayload("Which project?"), answers);
    expect(permission(decision).reason).toContain("no scripted answer");
    expect(traced[0].answer).toBeNull();
  });

  it("lets a mock muggle call through and records it", () => {
    const payload = { tool_name: "mcp__muggle__muggle_local_execute_replay", tool_input: { showUi: false } };
    const { decision, traced } = runHook(payload, answers);
    expect(decision).toBe("{}");
    expect(traced).toEqual([{ tool_name: payload.tool_name, tool_input: { showUi: false } }]);
  });

  it("denies every other tool", () => {
    const { decision } = runHook({ tool_name: "list_mcp_resources", tool_input: {} }, answers);
    expect(permission(decision).reason).toBe("[harness] tool list_mcp_resources is not available in this eval — the skill should not need it");
  });

  // The hook mirrors two rules of verdict.ts rather than importing them; any drift shows here.
  it("picks the answer the agent SDK harness would, from the same question", () => {
    const cases: Array<{ input: Record<string, unknown>; answers: Scenario["askQuestionAnswers"] }> = [
      { input: askPayload("Pick a use case to test").tool_input, answers: answers },
      { input: askPayload("Show the test browser, and which use case?").tool_input, answers: answers },
      { input: { question: "Show the test browser as it runs?" }, answers: answers },
      { input: { questions: [] }, answers: answers },
      { input: askPayload("Generate new or replay?").tool_input, answers: [] },
    ];
    for (const { input, answers: scripted } of cases) {
      const { traced } = runHook({ tool_name: "request_user_input", tool_input: input }, scripted);
      const scenario = { askQuestionAnswers: scripted } as Scenario;
      expect(traced[0].answer, JSON.stringify(input)).toBe(matchAskQuestionAnswer(extractFirstQuestionText(input), scenario));
    }
  });
});

describe("reading what a Codex run did", () => {
  it("maps each traced mock call back to the tool name scenarios use", () => {
    const dir = mkdtempSync(join(tmpdir(), "codex-gate-trace-"));
    const trace = join(dir, "trace.jsonl");
    const entries: CodexGateTraceEntry[] = [
      { tool_name: "mcp__muggle__muggle_local_check_status", tool_input: {} },
      { tool_name: "request_user_input", tool_input: askPayload("Show the test browser as it runs?").tool_input, answer: "Show it" },
      { tool_name: "list_mcp_resources", tool_input: {} },
      { tool_name: "mcp__muggle__muggle_local_execute_test_generation", tool_input: { showUi: true } },
    ];
    writeFileSync(trace, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const names = new Map(mockToolSpecs({}).map((spec) => [`mcp__muggle__${spec.name.replace(/[^A-Za-z0-9_]/g, "_")}`, spec.name]));
    const all = readCodexGateTrace(trace, 0, names);
    expect(all.entries).toBe(4);
    expect(all.mcpCalls).toEqual([
      { tool: "muggle-local-check-status", args: {} },
      { tool: "muggle-local-execute-test-generation", args: { showUi: true } },
    ]);
    expect(all.askQuestions).toEqual([{ question: "Show the test browser as it runs?", answer: "Show it" }]);
    expect(readCodexGateTrace(trace, 2, names).mcpCalls).toEqual([all.mcpCalls[1]]);
  });

  it("reads the thread, the closing message and a failure off Codex's own events", () => {
    expect(threadIdOf(COMPLETED_TURN)).toBe("01a15bcf-9756-7190-b680-2da821932067");
    expect(closingMessageOf(COMPLETED_TURN)).toBe("Show the test browser while it runs?\n1. Yes\n2. No");
    // The hook-trust bypass is reported as an error item on every session; it is not a failure.
    expect(turnFailureOf(COMPLETED_TURN)).toBe("");
    expect(turnFailureOf(RATE_LIMITED_TURN)).toContain("Rate limit reached");
  });
});

describe("the Codex home and prompt", () => {
  it("takes the Codex question rule from the skills' host-tool-equivalents table", () => {
    expect(codexQuestionGuidance(SKILLS_DIR)).toMatch(/^`request_user_input` where Codex offers it\./);
  });

  it("refuses a skills tree whose table has no AskUserQuestion row", () => {
    const skillsDir = mkdtempSync(join(tmpdir(), "codex-gate-skills-"));
    mkdirSync(join(skillsDir, "_shared"));
    writeFileSync(join(skillsDir, "_shared", "host-tool-equivalents.md"), "| `TodoWrite` | list | `update_plan` |\n");
    expect(() => codexQuestionGuidance(skillsDir)).toThrow(/no AskUserQuestion row/);
  });

  it("owns the Codex home it writes, and never overwrites someone's own", () => {
    const codexHome = mkdtempSync(join(tmpdir(), "codex-gate-home-"));
    prepareCodexGateHome(codexHome, { lastHost: "http://localhost:3000" });
    const config = readFileSync(join(codexHome, "config.toml"), "utf-8");
    expect(config.startsWith(CODEX_GATE_HOME_MARKER)).toBe(true);
    expect(config).toContain("shell_tool = false");
    expect(config).toContain('default_tools_approval_mode = "approve"');
    expect(() => prepareCodexGateHome(codexHome, {})).not.toThrow();

    const someonesHome = mkdtempSync(join(tmpdir(), "codex-real-home-"));
    writeFileSync(join(someonesHome, "config.toml"), 'model = "gpt-5.5"\n');
    expect(() => prepareCodexGateHome(someonesHome, {})).toThrow(/refusing to overwrite/);
    expect(readFileSync(join(someonesHome, "config.toml"), "utf-8")).toBe('model = "gpt-5.5"\n');
  });
});
