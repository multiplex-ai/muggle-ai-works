import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { isAbsolute, resolve, join } from 'path';
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
var MR_URL = /https?:\/\/[^/\s]+\/[^\s]+\/-\/merge_requests\/\d+/;
var CREATE_CMD = /\bgh\s+pr\s+(create|ready)\b/;
var MR_CREATE_CMD = /\bglab\s+mr\s+create\b|\bglab\s+mr\s+update\b.*--ready\b/;
function detectPrOpened(input2) {
  if (input2.tool_name !== "Bash") return null;
  const cmd = input2.tool_input?.command ?? "";
  if (!CREATE_CMD.test(cmd) && !MR_CREATE_CMD.test(cmd)) return null;
  const out = `${input2.tool_response?.stdout ?? ""}
${input2.tool_response?.output ?? ""}`;
  const m = out.match(PR_URL) ?? out.match(MR_URL);
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
var MAX_E2E_BLOCKS = 3;
function shouldRunE2E(state) {
  return state.unitTestsGreen === true && state.e2eRun !== true;
}
function e2eGateDecision(state, maxBlocks = MAX_E2E_BLOCKS) {
  const blockCount = state.e2eBlockCount ?? 0;
  if (!shouldRunE2E(state)) return { action: "none", blockCount };
  if (blockCount >= maxBlocks) return { action: "release", blockCount };
  return { action: "block", blockCount: blockCount + 1 };
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
var REPORT_SENTINEL = "muggle-pr-section";
var PR_POST_CMD = /\bgh\s+pr\s+(comment|create|edit)\b/;
var defaultReader = (path, cwd) => {
  try {
    const abs = isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path);
    if (!existsSync(abs)) return null;
    return readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
};
function unquote(s) {
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"') || t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1);
  }
  return t;
}
function looksLikeE2EReport(text) {
  const t = text.toLowerCase();
  const statusEmojis = (text.match(/[✅❌⚠]/gu) ?? []).length;
  const tally = /\b\d+\s+(tests?\s+)?passed\b/.test(t) && /\b\d+\s+(tests?\s+)?(failed|inconclusive)\b/.test(t);
  const slashTally = /\bpassed\b\s*[/|]\s*\d*\s*(tests?\s*)?\bfailed\b/.test(t) || /\bfailed\b\s*[/|]\s*\d*\s*(tests?\s*)?\bpassed\b/.test(t);
  const resultsStructure = /acceptance results/.test(t) || tally || slashTally || statusEmojis >= 2;
  const muggleContext = /\bmuggle\b/.test(t) || /muggle-ai\.com/.test(t) || /\be2e\b/.test(t) || /\bacceptance\b/.test(t);
  return resultsStructure && muggleContext;
}
function collectInspectableText(cmd, cwd, read) {
  let text = cmd;
  for (const m of cmd.matchAll(/--body-file[=\s]+("[^"]+"|'[^']+'|\S+)/g)) {
    const p = unquote(m[1]);
    if (p && p !== "-") {
      const c = read(p, cwd);
      if (c) text += "\n" + c;
    }
  }
  for (const m of cmd.matchAll(/jq\b[^|]*?("[^"]+\.json"|'[^']+\.json'|\S+\.json)/g)) {
    const c = read(unquote(m[1]), cwd);
    if (c) text += "\n" + c;
  }
  return text;
}
function evaluateReportPost(input2, read = defaultReader) {
  if (input2.tool_name !== "Bash") return { deny: false };
  const cmd = input2.tool_input?.command ?? "";
  if (!PR_POST_CMD.test(cmd)) return { deny: false };
  const text = collectInspectableText(cmd, input2.cwd, read);
  if (text.includes(REPORT_SENTINEL)) return { deny: false };
  if (!looksLikeE2EReport(text)) return { deny: false };
  return {
    deny: true,
    reason: "Blocked: this looks like a hand-written E2E test report. Muggle requires the deterministic renderer \u2014 build the run's E2eReport JSON and pipe it through `muggle build-pr-section` (or invoke /muggle:muggle-pr-visual-walkthrough), then post that output. Never hand-write the walkthrough markdown."
  };
}

// src/guardrails/emit.ts
function envelope(eventName, context, host2) {
  if (!context) return "{}";
  if (host2 === "cursor") return JSON.stringify({ additional_context: context });
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context }
  });
}
function blockStop(reason, host2) {
  if (!reason) return "{}";
  if (host2 === "cursor") return JSON.stringify({ additional_context: reason });
  return JSON.stringify({ decision: "block", reason });
}
function denyTool(reason, host2) {
  if (!reason) return "{}";
  if (host2 === "cursor") return JSON.stringify({ additional_context: reason });
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
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
  const decision = e2eGateDecision(state);
  if (decision.action === "none" || decision.action === "release") return "{}";
  state.e2eBlockCount = decision.blockCount;
  writeState(state);
  const reason = `Do not end the turn yet. Unit tests passed this session but no E2E acceptance run has happened. Per the autoE2ETest preference (default: always), run change-driven E2E now via /muggle:muggle-test, then finish. If E2E genuinely cannot run here (no app, services down, no PR), say so explicitly to the user \u2014 this gate releases after ${MAX_E2E_BLOCKS} attempts.`;
  return blockStop(reason, host);
}
function reportGate() {
  const result = evaluateReportPost(input);
  if (!result.deny || !result.reason) return "{}";
  return denyTool(result.reason, host);
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
  "report-gate": reportGate,
  "build-router": buildRouter
};
process.stdout.write((handlers[sub] ?? (() => "{}"))());
