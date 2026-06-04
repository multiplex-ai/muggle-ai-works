import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// src/guardrails/cli.ts
var baseDir = (override) => override ?? join(homedir(), ".muggle-ai", "guardrails");
var fileFor = (sessionId2, override) => join(baseDir(override), `${sessionId2.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);
function readState(sessionId2, dirOverride) {
  const f = fileFor(sessionId2, dirOverride);
  if (!existsSync(f)) return { sessionId: sessionId2, prsHandled: [] };
  try {
    const raw = JSON.parse(readFileSync(f, "utf-8"));
    return { ...raw, sessionId: sessionId2, prsHandled: raw.prsHandled ?? [] };
  } catch {
    return { sessionId: sessionId2, prsHandled: [] };
  }
}
function writeState(state, dirOverride) {
  mkdirSync(baseDir(dirOverride), { recursive: true });
  writeFileSync(fileFor(state.sessionId, dirOverride), JSON.stringify(state, null, 2));
}
function markPrHandled(sessionId2, prUrl, dirOverride) {
  const state = readState(sessionId2, dirOverride);
  if (!state.prsHandled.includes(prUrl)) state.prsHandled.push(prUrl);
  writeState(state, dirOverride);
}

// src/guardrails/prOpened.ts
var PR_URL = /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;
var CREATE_CMD = /\bgh\s+pr\s+(create|ready)\b/;
function detectPrOpened(input2) {
  if (input2.tool_name !== "Bash") return null;
  const cmd = input2.tool_input?.command ?? "";
  if (!CREATE_CMD.test(cmd)) return null;
  const out = `${input2.tool_response?.stdout ?? ""}
${input2.tool_response?.output ?? ""}`;
  const m = out.match(PR_URL);
  return m ? m[0] : null;
}

// src/guardrails/testsGreen.ts
var TEST_CMD = /\b(pnpm|npm|yarn)\s+(run\s+)?test\b|\b(jest|vitest|pytest)\b|\bgo\s+test\b|\bcargo\s+test\b/;
var FAIL = /\b\d+\s+failed\b|\bFAIL\b|✗/;
var E2E_RUN = /\bmuggle\b[^\n]*\b(execute|test)\b/i;
function isTestCommand(cmd) {
  return TEST_CMD.test(cmd);
}
function testsPassed(input2) {
  const out = `${input2.tool_response?.stdout ?? ""}
${input2.tool_response?.stderr ?? ""}`;
  if (!out.trim()) return false;
  return !FAIL.test(out);
}
function isE2ERun(input2) {
  const cmd = input2.tool_input?.command ?? "";
  const tool = input2.tool_name ?? "";
  return E2E_RUN.test(cmd) || /muggle.*(execute|test-generation|replay)/i.test(tool);
}

// src/guardrails/shouldRunE2E.ts
function shouldRunE2E(state) {
  return state.unitTestsGreen === true && state.e2eRun !== true;
}

// src/guardrails/detectBuildIntent.ts
var BUILD = /\b(implement|build|add|create|write|fix|refactor|wire up|hook up|make (a|the|it)|change the)\b/i;
var DEVCYCLE = /\bresolve\b[^.?!]{0,40}\bconflicts?\b|\bget\b[^.?!]{0,40}\bpr\b[^.?!]{0,40}\b(green|merged?|passing)\b/i;
var QUESTION = /^\s*(why|what|how|when|where|who|is|are|does|do|can you (explain|tell)|explain)\b/i;
function detectBuildIntent(prompt) {
  const p = (prompt ?? "").trim();
  if (!p || p.startsWith("/")) return false;
  if (QUESTION.test(p)) return false;
  return BUILD.test(p) || DEVCYCLE.test(p);
}

// src/guardrails/emit.ts
function envelope(eventName, context, host2) {
  if (!context) return "{}";
  if (host2 === "cursor") return JSON.stringify({ additional_context: context });
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context }
  });
}

// src/guardrails/cli.ts
function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf-8"));
  } catch {
    return {};
  }
}
var host = process.env.CURSOR_PLUGIN_ROOT ? "cursor" : "claude";
var sub = process.argv[2];
var input = readStdin();
var sessionId = input.session_id ?? "unknown";
function prOpened() {
  const url = detectPrOpened(input);
  if (!url) return "{}";
  if (readState(sessionId).prsHandled.includes(url)) return "{}";
  markPrHandled(sessionId, url);
  const ctx = `A pull request was just opened: ${url}
Per the autoWatchPR preference, a muggle-pr-followup watcher should handle its incoming reviews. If autoWatchPR=always, start it now by invoking /muggle:muggle-pr-followup with the PR URL; if =ask, offer it to the user; if =never, do nothing.`;
  return envelope("PostToolUse", ctx, host);
}
function recordTests() {
  const cmd = input.tool_input?.command ?? "";
  const state = readState(sessionId);
  let changed = false;
  if (isTestCommand(cmd) && testsPassed(input)) {
    state.unitTestsGreen = true;
    changed = true;
  }
  if (isE2ERun(input)) {
    state.e2eRun = true;
    changed = true;
  }
  if (changed) writeState(state);
  return "{}";
}
function e2eGate() {
  const state = readState(sessionId);
  if (!shouldRunE2E(state)) return "{}";
  state.e2eRun = true;
  writeState(state);
  const ctx = `Unit tests passed this session and no E2E acceptance run has happened yet. Per the autoE2ETest preference (default: always), run change-driven E2E now via /muggle:muggle-test before finishing. If autoE2ETest=never, skip.`;
  return envelope("Stop", ctx, host);
}
function buildRouter() {
  if (!detectBuildIntent(input.prompt ?? "")) return "{}";
  const state = readState(sessionId);
  if (state.buildIntentRouted) return "{}";
  state.buildIntentRouted = true;
  writeState(state);
  const ctx = `This looks like a build/implement/fix request. Per the autoRouteBuildToMuggleDo preference, route it through /muggle-do \u2014 which runs requirements \u2192 build (delegated to superpowers' design\u2192plan\u2192review) \u2192 impact \u2192 unit tests \u2192 E2E \u2192 PR \u2192 watcher. If autoRouteBuildToMuggleDo=always, enter that flow; if =ask, offer it; if =never, proceed normally.`;
  return envelope("UserPromptSubmit", ctx, host);
}
var handlers = {
  "pr-opened": prOpened,
  "record-tests": recordTests,
  "e2e-gate": e2eGate,
  "build-router": buildRouter
};
process.stdout.write((handlers[sub] ?? (() => "{}"))());
