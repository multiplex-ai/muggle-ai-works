import { readFileSync } from "fs";
import { readState, writeState, markPrHandled } from "./sessionState.js";
import { detectPrOpened } from "./prOpened.js";
import {
  detectPrTerminal,
  detectPrReopened,
  applyPrTerminalDetected,
  applyPrReopened,
  applyNextOptionsOffered,
  prTerminalGateDecision,
} from "./prTerminal.js";
import {
  MAX_DEBUG_BLOCKS,
  MAX_PR_TERMINAL_BLOCKS,
  MAX_REPLY_BLOCKS,
  MAX_STAGE_BLOCKS,
  MAX_WALKTHROUGH_BLOCKS,
  MAX_WATCH_BLOCKS,
} from "./constants.js";
import {
  applySkillInvocation,
  applyStageRead,
  applyStageSkip,
  isStageSkipMarker,
  resolvePluginSkillsRoot,
  resolveSkillNameFromToolInput,
  resolveSkillStagePaths,
  stageGateDecision,
  stageLabel,
  unreadMandatoryStages,
} from "./mandatoryStages.js";
import {
  applyClassificationSkip,
  applyClassifiedTestCase,
  classificationGateDecision,
  detectClassifiedTestCaseId,
  isClassificationSkipMarker,
} from "./preExecutionClassification.js";
import {
  applyDebugEvidence,
  applyDebugSkip,
  applyFailedRun,
  debugGateDecision,
  detectDebugEvidenceRunIds,
  detectFailedRunId,
  undebuggedFailedRuns,
} from "./debugPath.js";
import { isTestCommand, testsPassed, isE2ERun, isE2ESkipMarker } from "./testsGreen.js";
import { e2eGateDecision, E2eGateAction, MAX_E2E_BLOCKS, applyRecordedRun } from "./shouldRunE2E.js";
import {
  findUntrackedHandledPrs,
  watchGateDecision,
  isWatchSkipMarker,
  applyWatchSkip,
} from "./watchArmed.js";
import {
  detectWalkthroughPost,
  isWalkthroughSkipMarker,
  applyWalkthroughPosted,
  applyWalkthroughSkip,
} from "./walkthroughPosted.js";
import { scanForOwedWalkthroughs, walkthroughGateDecision } from "./walkthroughOwed.js";
import {
  applyPostedReplies,
  applyReplySkip,
  applyReviewWorkPush,
  applyUnansweredComments,
  commentReplyGateDecision,
  detectRepliedCommentIds,
  detectUnansweredCommentIds,
  isReviewWorkPush,
} from "./commentReply.js";
import { detectBuildIntent } from "./detectBuildIntent.js";
import { evaluateReportPost } from "./reportGate.js";
import { evaluateReviewThreadResolve } from "./reviewThreadResolve.js";
import { envelope, blockStop, denyTool, type Host } from "./emit.js";
import {
  CommentReplyGateAction,
  DebugGateAction,
  PrTerminalGateAction,
  StageGateAction,
  WalkthroughGateAction,
  WatchGateAction,
  type HookInput,
} from "./types.js";

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
  // Reopen first: it retracts a close, so a close+reopen within one tool output
  // must settle as open rather than arming a handoff for a live change.
  const reopenedPrNumber = detectPrReopened(input);
  if (reopenedPrNumber !== null) {
    const state = readState(sessionId);
    const next = applyPrReopened(state, reopenedPrNumber);
    if (next !== state) writeState(next);
    return "{}";
  }
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
  const recorded = applyRecordedRun(state, {
    unitTestPassed: isTestCommand(cmd) && testsPassed(input),
    e2eRan: isE2ERun(input),
    e2eSkipped: isE2ESkipMarker(cmd),
  });
  const withWatchSkip = applyWatchSkip(recorded, isWatchSkipMarker(cmd));
  const withWalkthroughPost = applyWalkthroughPosted(withWatchSkip, detectWalkthroughPost(input));
  const withWalkthroughSkip = applyWalkthroughSkip(withWalkthroughPost, isWalkthroughSkipMarker(cmd));
  const failedRunId = detectFailedRunId(input);
  const next = failedRunId ? applyFailedRun(withWalkthroughSkip, failedRunId) : withWalkthroughSkip;
  if (next !== state) writeState(next);
  return "{}";
}

function skillStages(): string {
  const skillName = resolveSkillNameFromToolInput(input.tool_input);
  if (!skillName) return "{}";
  const state = readState(sessionId);
  const next = applySkillInvocation(
    state,
    skillName,
    resolveSkillStagePaths(skillName, resolvePluginSkillsRoot()),
  );
  if (next !== state) writeState(next);
  const unread = unreadMandatoryStages(next);
  if (unread.length === 0) return "{}";
  // Injected at the moment of use, which is the only moment the requirement is
  // actionable: by the time the skill's steps are running, the step that needed
  // the stage file has already been improvised.
  const ctx =
    `The ${skillName} skill declares required reading: ${unread.map(stageLabel).join(", ")}. ` +
    `Read those files now, before working through the skill's steps — they carry mandatory steps ` +
    `SKILL.md only links to, and treating them as optional elaboration is how those steps get ` +
    `silently dropped. A Stop gate holds the turn open until they are opened.`;
  return envelope("PostToolUse", ctx, host);
}

function recordStageRead(): string {
  const filePath = input.tool_input?.file_path;
  if (!filePath) return "{}";
  const state = readState(sessionId);
  const next = applyStageRead(state, filePath);
  if (next !== state) writeState(next);
  return "{}";
}

function recordStageSignals(): string {
  const cmd = input.tool_input?.command ?? "";
  const state = readState(sessionId);
  const withStageSkip = applyStageSkip(state, isStageSkipMarker(cmd));
  const withClassificationSkip = applyClassificationSkip(
    withStageSkip,
    isClassificationSkipMarker(cmd),
  );
  const withDebugSkip = applyDebugSkip(withClassificationSkip, cmd);
  const classifiedTestCaseId = detectClassifiedTestCaseId(input);
  const withClassification = classifiedTestCaseId
    ? applyClassifiedTestCase(withDebugSkip, classifiedTestCaseId)
    : withDebugSkip;
  const next = applyDebugEvidence(
    withClassification,
    detectDebugEvidenceRunIds(input, undebuggedFailedRuns(withClassification)),
  );
  if (next !== state) writeState(next);
  return "{}";
}

function classifyGate(): string {
  const decision = classificationGateDecision(readState(sessionId), input);
  if (!decision.deny) return "{}";
  const reason =
    `Test case ${decision.testCaseId} has no pre-execution classification this session. ` +
    `Run muggle-test Step 6f for it first: classify replay-vs-regen per ` +
    `_shared/failure-mode-handling.md §A, then emit one ` +
    `muggle-local-telemetry-event-emit with eventType "pre-execution-classification" for this ` +
    `test case. That step is what calls muggle-remote-test-script-list, which is the only place ` +
    `this run learns the test case has never passed or has failed repeatedly — cheap now, ` +
    `~5 minutes of browser time to rediscover after the fact. If this execution genuinely has ` +
    `no classification step (a single user-picked target), say why and run ` +
    `\`echo "MUGGLE_CLASSIFY_SKIP: <reason>"\` — that records the skip for the rest of the session.`;
  return denyTool(reason, host);
}

function stageGate(): string {
  const state = readState(sessionId);
  const decision = stageGateDecision(state, unreadMandatoryStages(state));
  if (decision.action !== StageGateAction.Block) return "{}";
  state.stageBlockCount = decision.blockCount;
  writeState(state);
  const stageList = decision.unread.map(stageLabel).join(", ");
  // Full instruction once; repeats are one line (same rationale as e2eGate).
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. A skill invoked this session declares mandatory stages that were ` +
        `never opened: ${stageList}. Read them and carry out what they require — they are steps, ` +
        `not background reading, and SKILL.md only links to them. If they genuinely do not apply ` +
        `to this run, say why and run \`echo "MUGGLE_STAGE_SKIP: <reason>"\` — that records the ` +
        `skip and keeps this gate quiet for the rest of the session.`
      : `Mandatory stages still unread (reminder ${decision.blockCount}/${MAX_STAGE_BLOCKS}): ${stageList}. ` +
        `Read them, or record a legitimate skip via \`echo "MUGGLE_STAGE_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}

function debugPathGate(): string {
  const state = readState(sessionId);
  const decision = debugGateDecision(state);
  if (decision.action !== DebugGateAction.Block) return "{}";
  state.debugBlockCount = decision.blockCount;
  writeState(state);
  const runList = decision.undebugged.join(", ");
  // Full instruction once; repeats are one line (same rationale as e2eGate).
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. These runs failed and never went through the debug path: ${runList}. ` +
        `muggle-test Step 7C makes that mandatory — route each through _shared/debug-failed-run.md: ` +
        `gather the attempted steps and the failing screenshot, diagnose the bucket per ` +
        `_shared/failure-mode-handling.md §B/§C with its classified telemetry emit, and present the ` +
        `offer in which "give feedback & rerun" is always available. A summarized-and-dropped failure ` +
        `is the run a reviewer most needs to see. If a run genuinely cannot be debugged, run ` +
        `\`echo "MUGGLE_DEBUG_SKIP: <runId> <reason>"\` — that clears just that run.`
      : `Failed runs still owe the debug path (reminder ${decision.blockCount}/${MAX_DEBUG_BLOCKS}): ${runList}. ` +
        `Route each through _shared/debug-failed-run.md, or record a legitimate skip via ` +
        `\`echo "MUGGLE_DEBUG_SKIP: <runId> <reason>"\`.`;
  return blockStop(reason, host);
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

function watchGate(): string {
  const state = readState(sessionId);
  const untrackedPrUrls = findUntrackedHandledPrs(state.prsHandled);
  const decision = watchGateDecision(state, untrackedPrUrls);
  if (decision.action === WatchGateAction.None || decision.action === WatchGateAction.Release) {
    return "{}";
  }
  state.watchBlockCount = decision.blockCount;
  writeState(state);
  const prList = decision.untracked.join(", ");
  // Full instruction once; repeats are one line — same rationale as e2eGate.
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. A PR was opened this session but no muggle-do session slot tracks it: ${prList}. ` +
        `Seed the slot and hand off per muggle-do Stage 8 — /muggle:muggle-pr-followup ${decision.untracked[0]} ` +
        `does both. Seeding is what matters: once a slot exists, reconcile arms it at the next session start ` +
        `and finalizes it when the PR goes terminal, so an unarmed slot is fine but no slot means nothing ever ` +
        `picks this PR up. If it genuinely should not be tracked (autoWatchPR=never, handed off elsewhere), ` +
        `tell the user why and run \`echo "MUGGLE_WATCH_SKIP: <reason>"\` — that records the skip and keeps ` +
        `this gate quiet for the rest of the session.`
      : `PR hand-off still owed for ${prList} (reminder ${decision.blockCount}/${MAX_WATCH_BLOCKS}): ` +
        `seed a slot via /muggle:muggle-pr-followup, or record a legitimate skip via \`echo "MUGGLE_WATCH_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}

function walkthroughGate(): string {
  const state = readState(sessionId);
  if (
    state.e2eRun !== true ||
    state.walkthroughPosted === true ||
    state.walkthroughSkipped === true
  ) {
    return "{}";
  }
  const scan = scanForOwedWalkthroughs(state);
  if (scan.owed.length === 0) {
    // Cache a walkthrough found on the PR itself, so later turn ends settle from
    // state and never repeat the provider lookups.
    if (scan.verified.length > 0) writeState({ ...state, walkthroughPosted: true });
    return "{}";
  }
  const decision = walkthroughGateDecision(state, scan.owed);
  if (decision.action !== WalkthroughGateAction.Block) return "{}";
  state.walkthroughBlockCount = decision.blockCount;
  writeState(state);
  const prList = decision.owed.join(", ");
  // Full instruction once; repeats are one line — same rationale as e2eGate.
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. An E2E acceptance run happened this session but no visual walkthrough ` +
        `has reached ${prList}. Per the postPRVisualWalkthrough preference (default: always), post it now ` +
        `via /muggle:muggle-pr-visual-walkthrough — include the failed runs, which are the ones reviewers ` +
        `most need to see. If this result genuinely should not be posted (postPRVisualWalkthrough=never, ` +
        `someone else's PR, nothing renderable), tell the user why and run ` +
        `\`echo "MUGGLE_WALKTHROUGH_SKIP: <reason>"\` — that records the skip and keeps this gate quiet ` +
        `for the rest of the session.`
      : `Walkthrough still owed for ${prList} (reminder ${decision.blockCount}/${MAX_WALKTHROUGH_BLOCKS}): ` +
        `post via /muggle:muggle-pr-visual-walkthrough, or record a legitimate skip via ` +
        `\`echo "MUGGLE_WALKTHROUGH_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}

function recordCommentReplies(): string {
  const cmd = input.tool_input?.command ?? "";
  const state = readState(sessionId);
  const withOwed = applyUnansweredComments(state, detectUnansweredCommentIds(input));
  const withPosted = applyPostedReplies(withOwed, detectRepliedCommentIds(input));
  const withPush = applyReviewWorkPush(withPosted, isReviewWorkPush(cmd));
  const next = applyReplySkip(withPush, cmd);
  if (next !== state) writeState(next);
  return "{}";
}

function commentReplyGate(): string {
  const state = readState(sessionId);
  const decision = commentReplyGateDecision(state);
  if (decision.action !== CommentReplyGateAction.Block) return "{}";
  state.commentReplyBlockCount = decision.blockCount;
  writeState(state);
  const commentList = decision.unanswered.join(", ");
  // Full instruction once; repeats are one line (same rationale as e2eGate).
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. The change addressing these review comments was pushed, but they ` +
        `carry no threaded reply: ${commentList}. Post one reply per comment in its own thread per ` +
        `muggle-do do/per-comment-replies.md — "Addressed in <short-sha>: <what changed for THIS ` +
        `comment>", signed via sign-body.sh --mode loop. A silent push leaves the reviewer with no ` +
        `answer in the thread, and the loop marker that reply carries is the only thing that stops ` +
        `the watcher re-dispatching the same thread next tick. If a comment was escalated to the ` +
        `user instead of answered, say why and run \`echo "MUGGLE_REPLY_SKIP: <commentId> <reason>"\` ` +
        `— that clears just that comment.`
      : `Review comments still owe a threaded reply (reminder ${decision.blockCount}/${MAX_REPLY_BLOCKS}): ` +
        `${commentList}. Reply per do/per-comment-replies.md, or record a legitimate skip via ` +
        `\`echo "MUGGLE_REPLY_SKIP: <commentId> <reason>"\`.`;
  return blockStop(reason, host);
}

function reportGate(): string {
  const reportPostVerdict = evaluateReportPost(input);
  if (!reportPostVerdict.deny || !reportPostVerdict.reason) return "{}";
  return denyTool(reportPostVerdict.reason, host);
}

function resolveGate(): string {
  const resolveVerdict = evaluateReviewThreadResolve(input);
  if (!resolveVerdict.deny || !resolveVerdict.reason) return "{}";
  return denyTool(resolveVerdict.reason, host);
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
  "watch-gate": watchGate,
  "walkthrough-gate": walkthroughGate,
  "record-comment-replies": recordCommentReplies,
  "comment-reply-gate": commentReplyGate,
  "report-gate": reportGate,
  "resolve-gate": resolveGate,
  "build-router": buildRouter,
  "skill-stages": skillStages,
  "record-stage-read": recordStageRead,
  "record-stage-signals": recordStageSignals,
  "classify-gate": classifyGate,
  "stage-gate": stageGate,
  "debug-path-gate": debugPathGate,
};
process.stdout.write((handlers[sub] ?? (() => "{}"))());
