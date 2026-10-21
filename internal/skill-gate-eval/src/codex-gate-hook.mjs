#!/usr/bin/env node

// PreToolUse hook the Codex gate harness installs (codex-harness.ts). It records
// every tool call to the file MUGGLE_GATE_EVAL_TRACE names, and decides each the
// way the agent SDK harness's canUseTool does: a mock muggle call runs; Codex's
// `request_user_input` is answered from the scenario's scripted answers
// (MUGGLE_GATE_EVAL_ANSWERS) by denying it with the user's pick — the channel
// the agent SDK harness answers AskUserQuestion on; anything else is denied,
// because the skill should not need it.
//
// Plain JavaScript rather than TypeScript under tsx, which would add half a
// second to every tool call. The two rules it shares with verdict.ts are
// mirrored below, and test/codex-harness.test.ts holds them equal.

import { appendFileSync, readFileSync } from "node:fs";

const MOCK_MUGGLE_TOOL_PREFIX = "mcp__muggle__";
const ASK_QUESTION_TOOL = "request_user_input";

function readJson(source) {
    try {
        return JSON.parse(readFileSync(source, "utf-8"));
    } catch {
        return null;
    }
}

/** verdict.ts `extractFirstQuestionText`: the first question's text, or a flat `question`. */
function firstQuestionText(input) {
    const questions = input.questions;
    if (Array.isArray(questions) && questions.length > 0) {
        return typeof questions[0]?.question === "string" ? questions[0].question : "";
    }
    return typeof input.question === "string" ? input.question : "";
}

/** verdict.ts `matchAskQuestionAnswer`: the first scripted answer whose `questionContains` the question includes. */
function scriptedAnswer(question, answers) {
    const match = answers.find((entry) => question.includes(entry.questionContains));
    return match ? match.answer : null;
}

function deny(reason) {
    return JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    });
}

const payload = readJson(0) ?? {};
const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
const toolInput = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};
const entry = { tool_name: toolName, tool_input: toolInput };
let decision = "{}";
if (toolName === ASK_QUESTION_TOOL) {
    const answers = readJson(process.env.MUGGLE_GATE_EVAL_ANSWERS ?? "") ?? [];
    entry.answer = scriptedAnswer(firstQuestionText(toolInput), answers);
    decision = deny(
        entry.answer !== null
            ? `User selected: "${entry.answer}"`
            : "[harness] no scripted answer for this question — scenario should add one",
    );
} else if (!toolName.startsWith(MOCK_MUGGLE_TOOL_PREFIX)) {
    decision = deny(`[harness] tool ${toolName} is not available in this eval — the skill should not need it`);
}
if (process.env.MUGGLE_GATE_EVAL_TRACE) {
    appendFileSync(process.env.MUGGLE_GATE_EVAL_TRACE, `${JSON.stringify(entry)}\n`);
}
process.stdout.write(decision);
