import { readFileSync } from "fs";
import { readState, writeState, markPrHandled } from "./sessionState.js";
import { detectPrOpened } from "./prOpened.js";
import {
  detectPrTerminal,
  applyPrTerminalDetected,
  applyNextOptionsOffered,
  prTerminalGateDecision,
  PrTerminalGateAction,
  MAX_PR_TERMINAL_BLOCKS,
} from "./prTerminal.js";
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

function prTerminal(): string {
  const terminalEvent = detectPrTerminal(input);
  if (!terminalEvent) return "{}";
  const state = readState(sessionId);
  const next = applyPrTerminalDetected(state, terminalEvent.prNumber);
  if (next === state) return "{}";
  writeState(next);
  const ctx =
    `PR #${terminalEvent.prNumber} went terminal (${terminalEvent.verdict}). Run the post-merge handoff now: ` +
    `finalize the watcher slot, tear down per autoCleanup, then OFFER NEXT OPTIONS to the user ` +
    `(AskUserQuestion) — release, queued work, deferred items. The stop gate holds until the offer runs.`;
  return envelope("PostToolUse", ctx, host);
}

function offerRan(): string {
  if (input.tool_name !== "AskUserQuestion") return "{}";
  const state = readState(sessionId);
  const next = applyNextOptionsOffered(state);
  if (next !== state) writeState(next);
  return "{}";
}

function terminalGate(): string {
  const state = readState(sessionId);
  const decision = prTerminalGateDecision(state);
  if (decision.action !== PrTerminalGateAction.Block) return "{}";
  state.terminalBlockCount = decision.blockCount;
  writeState(state);
  const pendingPrList = (state.terminalPending ?? []).map((prNumber) => `#${prNumber}`).join(", ");
  // Full instruction once; repeats are one line (same rationale as e2eGate).
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. PR ${pendingPrList} went terminal (merged/closed) but the post-merge ` +
        `handoff has not run. Finalize the watcher slot, tear down per autoCleanup, then offer next ` +
        `options to the user via AskUserQuestion — release, queued work, deferred items. Only the ` +
        `AskUserQuestion offer clears this gate.`
      : `Post-merge handoff still owed for PR ${pendingPrList} (reminder ${decision.blockCount}/${MAX_PR_TERMINAL_BLOCKS}): ` +
        `finalize + tear down, then run the AskUserQuestion next-options offer.`;
  return blockStop(reason, host);
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
  "pr-terminal": prTerminal,
  "offer-ran": offerRan,
  "record-tests": recordTests,
  "e2e-gate": e2eGate,
  "terminal-gate": terminalGate,
  "report-gate": reportGate,
  "build-router": buildRouter,
};
process.stdout.write((handlers[sub] ?? (() => "{}"))());
