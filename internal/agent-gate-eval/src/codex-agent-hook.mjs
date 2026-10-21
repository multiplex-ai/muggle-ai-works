#!/usr/bin/env node

// PreToolUse hook the Codex agent harness installs (codex-harness.ts). It
// records every tool call to the file MUGGLE_AGENT_EVAL_TRACE names, and decides
// each the way the agent SDK harness's canUseTool does:
//   - a shell call that only reads files in the plugin tree runs, as the agent
//     SDK harness's plugin-scoped Read does, so the stage files an agent links
//     must really resolve;
//   - every other shell call is blocked, and the block carries the scenario's
//     scripted output for it (MUGGLE_AGENT_EVAL_BASH), marked SIMULATED OUTPUT —
//     the channel the agent SDK harness answers Bash on;
//   - a mock muggle call runs; request_user_input is denied, since there is no
//     user; anything else is denied.
//
// Plain JavaScript rather than TypeScript under tsx, which would add half a
// second to every tool call. Its one rule shared with tools/scripted-replies.ts
// — the first scripted response whose `commandContains` the command includes —
// is held equal by test/codex-harness.test.ts. Each call is answered alone, so
// a response's `sequence` has no meaning here; codex-harness.ts refuses
// scenarios that use one.

import { appendFileSync, readFileSync } from "node:fs";
import * as path from "node:path";

const MOCK_MUGGLE_TOOL_PREFIX = "mcp__muggle__";
const ASK_QUESTION_TOOL = "request_user_input";

// Commands that print files and change nothing, in POSIX shells and PowerShell.
const READ_VERBS = new Set(["cat", "head", "tail", "nl", "wc", "sed", "grep", "rg", "ls", "Get-Content", "gc", "type", "Select-String"]);
// Anything that chains, redirects, substitutes or expands: the command would do more than read what it names.
const BEYOND_A_PLAIN_READ = /[;&<>`$\n\r(){}]/;

function readJson(source) {
    try {
        return JSON.parse(readFileSync(source, "utf-8"));
    } catch {
        return null;
    }
}

/** A command stage's words, quotes removed; null when its quoting does not close. */
function shellWords(text) {
    const words = [];
    let current = "";
    let quote = null;
    let inWord = false;
    for (const character of text) {
        if (quote) {
            if (character === quote) quote = null;
            else current += character;
        } else if (character === "'" || character === '"') {
            quote = character;
            inWord = true;
        } else if (/\s/.test(character)) {
            if (inWord) words.push(current);
            current = "";
            inWord = false;
        } else {
            current += character;
            inWord = true;
        }
    }
    if (quote) return null;
    if (inWord) words.push(current);
    return words;
}

function isInside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * True when every stage of `command` only reads, and every path it names —
 * any word with a path separator — is inside `readRoot`. A stage piped into
 * names no path of its own. Without a path at all it is not a read of the
 * plugin tree, and gets its scripted output like any other command.
 */
function readsOnlyThePluginTree(command, readRoot, cwd) {
    if (BEYOND_A_PLAIN_READ.test(command)) return false;
    let namedAPath = false;
    for (const stage of command.split("|")) {
        const words = shellWords(stage.trim());
        if (!words || words.length === 0 || !READ_VERBS.has(words[0])) return false;
        if (words[0] === "sed" && (!words.includes("-n") || words.some((word) => /^-[A-Za-z]*i|^--in-place/.test(word)))) {
            return false;
        }
        for (const word of words.slice(1)) {
            if (word.startsWith("-") || !/[\\/]/.test(word)) continue;
            if (!isInside(readRoot, path.resolve(cwd, word))) return false;
            namedAPath = true;
        }
    }
    return namedAPath;
}

/** scripted-replies.ts `resolveScriptedBashResponse`: the first scripted response the command contains, else the unscripted one. */
function scriptedOutput(command, scripted) {
    const match = (scripted.responses ?? []).find((entry) => command.includes(entry.commandContains));
    return match ? match.response : scripted.unscripted;
}

function deny(reason) {
    return JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
    });
}

const payload = readJson(0) ?? {};
const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "";
const toolInput = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};
const readRoot = process.env.MUGGLE_AGENT_EVAL_READ_ROOT ?? "";
let decision = "{}";
if (toolName === "Bash") {
    const command = String(toolInput.command ?? "");
    const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
    if (!readRoot || !readsOnlyThePluginTree(command, path.resolve(readRoot), cwd)) {
        const scripted = readJson(process.env.MUGGLE_AGENT_EVAL_BASH ?? "") ?? { responses: [], unscripted: "" };
        decision = deny(`SIMULATED OUTPUT (treat as the command's real result):\n${scriptedOutput(command, scripted)}`);
    }
} else if (toolName === ASK_QUESTION_TOOL) {
    decision = deny("[harness] there is no user in this environment — return a `needs-input:` line instead of asking");
} else if (!toolName.startsWith(MOCK_MUGGLE_TOOL_PREFIX)) {
    decision = deny(`[harness] tool ${toolName} is not available in this eval`);
}
if (process.env.MUGGLE_AGENT_EVAL_TRACE) {
    appendFileSync(process.env.MUGGLE_AGENT_EVAL_TRACE, `${JSON.stringify({ tool_name: toolName, tool_input: toolInput })}\n`);
}
process.stdout.write(decision);
