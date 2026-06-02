import { readFileSync } from "fs";
import { readState, writeState, markPrHandled } from "./sessionState.js";
import { detectPrOpened } from "./prOpened.js";
import { isTestCommand, testsPassed, isE2ERun } from "./testsGreen.js";
import { shouldRunE2E } from "./shouldRunE2E.js";
import { detectBuildIntent } from "./detectBuildIntent.js";
import { envelope, type Host } from "./emit.js";
import type { HookInput } from "./types.js";

function readStdin(): HookInput {
  try {
    return JSON.parse(readFileSync(0, "utf-8")) as HookInput;
  } catch {
    return {};
  }
}

const host: Host = process.env.CURSOR_PLUGIN_ROOT ? "cursor" : "claude";
const sub = process.argv[2];
const input = readStdin();
const sessionId = input.session_id ?? "unknown";

function prOpened(): string {
  const url = detectPrOpened(input);
  if (!url) return "{}";
  if (readState(sessionId).prsHandled.includes(url)) return "{}";
  markPrHandled(sessionId, url);
  const ctx =
    `A pull request was just opened: ${url}\n` +
    `Per the autoWatchPR preference, a muggle-pr-followup watcher should handle its incoming reviews. ` +
    `If autoWatchPR=always, start it now by invoking /muggle:muggle-pr-followup with the PR URL; ` +
    `if =ask, offer it to the user; if =never, do nothing.`;
  return envelope("PostToolUse", ctx, host);
}

function recordTests(): string {
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

function e2eGate(): string {
  const state = readState(sessionId);
  if (!shouldRunE2E(state)) return "{}";
  state.e2eRun = true;
  writeState(state);
  const ctx =
    `Unit tests passed this session and no E2E acceptance run has happened yet. ` +
    `Per the autoE2ETest preference (default: always), run change-driven E2E now via /muggle:muggle-test ` +
    `before finishing. If autoE2ETest=never, skip.`;
  return envelope("Stop", ctx, host);
}

function buildRouter(): string {
  if (!detectBuildIntent(input.prompt ?? "")) return "{}";
  const state = readState(sessionId);
  if (state.buildIntentRouted) return "{}";
  state.buildIntentRouted = true;
  writeState(state);
  const ctx =
    `This looks like a build/implement/fix request. Per the autoRouteBuildToMuggleDo preference, ` +
    `route it through /muggle-do — which runs requirements → build (delegated to superpowers' ` +
    `design→plan→review) → impact → unit tests → E2E → PR → watcher. ` +
    `If autoRouteBuildToMuggleDo=always, enter that flow; if =ask, offer it; if =never, proceed normally.`;
  return envelope("UserPromptSubmit", ctx, host);
}

const handlers: Record<string, () => string> = {
  "pr-opened": prOpened,
  "record-tests": recordTests,
  "e2e-gate": e2eGate,
  "build-router": buildRouter,
};
process.stdout.write((handlers[sub] ?? (() => "{}"))());
