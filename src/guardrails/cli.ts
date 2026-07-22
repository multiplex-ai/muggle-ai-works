import { readFileSync } from "fs";
import { readState, writeState, markPrHandled } from "./sessionState.js";
import { detectPrOpened } from "./prOpened.js";
import { isTestCommand, testsPassed, isE2ERun, isE2ESkipMarker } from "./testsGreen.js";
import { e2eGateDecision, E2eGateAction, MAX_E2E_BLOCKS, applyRecordedRun } from "./shouldRunE2E.js";
import { detectBuildIntent } from "./detectBuildIntent.js";
import { evaluateReportPost } from "./reportGate.js";
import { envelope, blockStop, denyTool, type Host } from "./emit.js";
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
  const next = applyRecordedRun(state, {
    unitTestPassed: isTestCommand(cmd) && testsPassed(input),
    e2eRan: isE2ERun(input),
    e2eSkipped: isE2ESkipMarker(cmd),
  });
  if (next !== state) writeState(next);
  return "{}";
}

function e2eGate(): string {
  const state = readState(sessionId);
  const decision = e2eGateDecision(state);
  if (decision.action === E2eGateAction.None || decision.action === E2eGateAction.Release) return "{}";
  state.e2eBlockCount = decision.blockCount;
  writeState(state);
  // Full instruction once; repeats are one line. The first block already
  // taught the model both exits, so repeating the paragraph is pure noise.
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. Unit tests passed this session but no E2E acceptance run has happened. ` +
        `Per the autoE2ETest preference (default: always), run change-driven E2E now via /muggle:muggle-test, ` +
        `then finish. If E2E genuinely cannot run here (no app to drive, services down, no PR), tell the user ` +
        `why and run \`echo "MUGGLE_E2E_SKIP: <reason>"\` — that records the skip and keeps this gate quiet ` +
        `for the rest of the session.`
      : `E2E acceptance run still owed (reminder ${decision.blockCount}/${MAX_E2E_BLOCKS}): ` +
        `run /muggle:muggle-test, or record a legitimate skip via \`echo "MUGGLE_E2E_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}

function reportGate(): string {
  const result = evaluateReportPost(input);
  if (!result.deny || !result.reason) return "{}";
  return denyTool(result.reason, host);
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
  "report-gate": reportGate,
  "build-router": buildRouter,
};
process.stdout.write((handlers[sub] ?? (() => "{}"))());
