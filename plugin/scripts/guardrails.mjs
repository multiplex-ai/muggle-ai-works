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
var handlers = { "pr-opened": prOpened };
process.stdout.write((handlers[sub] ?? (() => "{}"))());
