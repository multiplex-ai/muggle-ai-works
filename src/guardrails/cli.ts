import { readFileSync } from "fs";
import {
  readState,
  readWalkthroughScan,
  writeWalkthroughScan,
  readPrStateScan,
  writePrStateScan,
} from "./sessionState.js";
import { isBackgroundJob, startBackgroundJob } from "./backgroundJob.js";
import { commitDeferredSessionState, commitStateMutation } from "./stateCommit.js";
import { detectPrOpened } from "./prOpened.js";
import { detectPrTerminal, detectPrReopened, closingMessageAsksUser, prTerminalGateDecision } from "./prTerminal.js";
import {
  CAPABILITY_CLAIM_TRANSCRIPT_TAIL_BYTES,
  MAX_DEBUG_BLOCKS,
  MAX_PR_TERMINAL_BLOCKS,
  MAX_REPLY_BLOCKS,
  MAX_STAGE_BLOCKS,
  MAX_WALKTHROUGH_BLOCKS,
  MAX_WATCH_BLOCKS,
  MAX_BUILD_BLOCKS,
  NEXT_OPTIONS_OFFER_TOOL_NAMES,
  WATCH_HEARTBEAT_STALE_MS,
  WATCH_HOLD_PHRASE_PREFIX,
  WATCH_HOLD_TRANSCRIPT_TAIL_BYTES,
} from "./constants.js";
import { detectFalseCapabilityClaim, lastAssistantText } from "./capabilityClaim.js";
import {
  detectShellStageReads,
  isSkillTreeMarkdown,
  isStageSkipMarker,
  resolvePluginSkillsRoot,
  resolveSkillNameFromToolInput,
  resolveSkillStagePaths,
  stageGateDecision,
  stageLabel,
  unreadMandatoryStages,
} from "./mandatoryStages.js";
import {
  classificationGateDecision,
  detectClassifiedTestCaseId,
  isClassificationSkipMarker,
} from "./preExecutionClassification.js";
import {
  debugGateDecision,
  detectDebugEvidenceRunIds,
  detectFailedRunId,
  isDebugSkipMarker,
  undebuggedFailedRuns,
} from "./debugPath.js";
import { isTestCommand, testsPassed, isE2ERun } from "./testsGreen.js";
import { e2eGateDecision, E2eGateAction, MAX_E2E_BLOCKS } from "./shouldRunE2E.js";
import {
  findUnwatchedHandledPrs,
  ownsOpenWatchSlot,
  prsAwaitingStateScan,
  resolveOwedWatchPrs,
  scanProviderPrStates,
  watchGateDecision,
  isWatchSkipMarker,
} from "./watchArmed.js";
import {
  applyWatchHolds,
  findOwedWatchWork,
  heldPrNumbersIn,
  watchFollowThroughDecision,
} from "./watchFollowThrough.js";
import { resolveWatchPreferences } from "../pr-watch/watchPreferences.js";
import { readFileTail } from "../transcript/userTurns.js";
import { buildFollowthroughDecision, isBuildSkipMarker } from "./buildFollowthrough.js";
import { detectWalkthroughPost, detectWalkthroughPostTargets, isWalkthroughSkipMarker } from "./walkthroughPosted.js";
import {
  withoutPostedPrs,
  defaultPrWalkthroughLookup,
  isWalkthroughGateArmed,
  isWalkthroughScanCurrent,
  scanForOwedWalkthroughs,
  walkthroughGateDecision,
} from "./walkthroughOwed.js";
import { detectBackgroundAcceptanceDispatch, withoutDelegatedPrs } from "./delegatedE2e.js";
import { isPrCoveredBySkip } from "./skipScope.js";
import { resolveOpenedPrChange, resolveTreeChange } from "./changeIdentity.js";
import {
  isWalkthroughSettledOnPr,
  noteE2eRunStarted,
  reserveWalkthroughComment,
  settleWalkthroughCommentAsSkipped,
  settleWalkthroughCommentForNoAppLogicChange,
} from "../pr-walkthrough/reserve.js";
import { CYCLE_SCOPED_SKIP_CODES, E2E_SKIP_CODES, NON_APP_PATH_SUMMARY } from "../e2e-skip/constants.js";
import { explainRejection } from "../e2e-skip/resolveSkip.js";
import { E2eSkipCode, type DeclaredSkip } from "../e2e-skip/types.js";
import { judgeE2eSkip } from "./skipReason.js";
import { evaluateWalkthroughHeadingPost } from "./walkthroughHeadingGate.js";
import {
  commentReplyGateDecision,
  detectConfirmedReplies,
  detectUnansweredThreads,
  isReplySkipMarker,
  overdueThreads,
  resolveSlotForPr,
  threadForReplyTarget,
  deferredCommentIds,
} from "./commentReply.js";
import { commitThread, readLedger } from "./ledger/store.js";
import { claimThread, coverComments, refreshHumanComments, uncoveredComments } from "./ledger/obligations.js";
import { detectBuildIntent, isMuggleDoForwardInvocation } from "./detectBuildIntent.js";
import { callFailed } from "./callOutcome.js";
import { evaluateReportPost } from "./reportGate.js";
import { evaluateReviewThreadResolve } from "./reviewThreadResolve.js";
import { envelope, blockStop, denyTool, mergeHookOutputs, type Host } from "./emit.js";
import { normalizeHookInput } from "./hookInput.js";
import { resolveHookHost, skillInvocation } from "./hookHost.js";
import { isShellToolCall } from "./shellTool.js";
import { enforceHookChildProcessDeadline } from "../hook-budget/childProcessBudget.js";
import {
  type GuardrailState,
  CommentReplyGateAction,
  DebugGateAction,
  PrTerminalGateAction,
  StageGateAction,
  WalkthroughGateAction,
  WatchGateAction,
  WatchFollowThroughAction,
  OwedWatchWorkKind,
  BuildFollowthroughAction,
  GuardrailBackgroundJob,
  StateMutationKind,
  type HookInput,
  type OwedWatchWork,
  type ToolOutcomeMutation,
} from "./types.js";

function readStdin(): HookInput {
  try {
    return normalizeHookInput(JSON.parse(readFileSync(0, "utf-8")));
  } catch {
    return {};
  }
}

const host: Host = resolveHookHost();
const sub = process.argv[2];
// A background job runs detached, so nothing waits on it and its lookups keep their full timeouts.
if (!isBackgroundJob(sub)) enforceHookChildProcessDeadline();
const input = readStdin();
const sessionId = input.session_id ?? "unknown";

/**
 * Record that a Stop gate has spent its block budget.
 *
 * Every gate runs on every turn end and pre-filters on the session state file.
 * Nothing in that file changes when a gate releases, so a released gate keeps
 * cold-starting Node for the rest of the session — and the walkthrough gate
 * keeps making provider calls — to return "{}" every time. Stamping the release
 * is what lets the pre-filter fall through in shell instead.
 */
function releaseGate(field: keyof GuardrailState): string {
  // A stamp already set commits nothing: the wrapper pre-filter short-circuits
  // from the next turn on, but a handler invoked directly must not keep
  // rewriting state — that is the churn this stamp exists to end.
  commitStateMutation(sessionId, { kind: StateMutationKind.Fields, fields: { [field]: true } });
  return "{}";
}

/** Record a Stop gate's running block count, which its next turn end reads to escalate and finally release. */
function recordGateBlock(field: keyof GuardrailState, blockCount: number): void {
  commitStateMutation(sessionId, { kind: StateMutationKind.Fields, fields: { [field]: blockCount } });
}

/** A Muggle skill invocation as the firing host spells it — see skillInvocation. */
function muggleSkill(slashCommand: string): string {
  return skillInvocation(slashCommand, host);
}

// Codex offers its structured question tool only in some modes, so there the
// next-options offer is the question the turn closes on. Claude Code asks it the
// same way while the session still owns an open PR's watch: a pending
// AskUserQuestion holds the turn, so that watcher's rollover goes unanswered
// until the user replies.
function isOfferAskedInClosingMessage(): boolean {
  return host === "codex" || ownsOpenWatchSlot(sessionId);
}

function nextOptionsOfferMethod(isAskedInClosingMessage: boolean): string {
  if (host === "codex") return "by asking them in your closing message (request_user_input where it is available)";
  return isAskedInClosingMessage
    ? "as text in your closing message, numbered and ending on the question — this session still watches an open " +
        "PR, and an AskUserQuestion would hold the turn while its watcher goes unanswered"
    : "via AskUserQuestion";
}

function prOpened(): string {
  const url = detectPrOpened(input);
  if (!url) return "{}";
  if (readState(sessionId).prsHandled.includes(url)) return "{}";
  const prChange = resolveOpenedPrChange(input.tool_input?.command ?? "", url, input.cwd);
  // Recorded as handled in the same commit, and a new PR has not been checked
  // for a walkthrough or a skip's record yet, so the gate re-arms for it.
  const stateAfterOpen = commitStateMutation(sessionId, {
    kind: StateMutationKind.PrOpened,
    prUrl: url,
    prChange: prChange,
  });
  // Only a skip verified for this PR's repo and branch vouches for it; a PR of
  // any other change owes its own run or skip.
  const declaredSkip = isPrCoveredBySkip(stateAfterOpen, url) ? stateAfterOpen.e2eSkipDeclaration : undefined;
  // A skip accepted before the PR existed — the forward cycle's order, Stage 6
  // before Stage 7 — is written straight into the slot, so the PR never shows
  // an empty placeholder for a decision already made. Otherwise the slot is
  // reserved at open rather than at post time: a PR whose slot exists from the
  // first minute shows reviewers that evidence is coming, and gives both the
  // Stop gate and the CI check one fixed comment to settle instead of guessing
  // which of a thread's comments was meant to carry the walkthrough.
  if (declaredSkip) {
    startBackgroundJob(GuardrailBackgroundJob.SettleWalkthroughSkipped, [url, declaredSkip.code, declaredSkip.detail]);
  } else {
    startBackgroundJob(GuardrailBackgroundJob.ReserveWalkthroughComment, [url]);
  }
  if (isWalkthroughGateArmed(stateAfterOpen)) {
    startBackgroundJob(GuardrailBackgroundJob.ScanWalkthroughs, [sessionId], input.cwd);
  }
  const slotNote = declaredSkip
    ? `Its Muggle AI visual-walkthrough comment is being settled with the E2E skip already recorded this ` +
      `session (${declaredSkip.code}); the turn cannot end until the PR shows it.\n`
    : `Its Muggle AI visual-walkthrough comment is being reserved. When every path the PR changes is ` +
      `${NON_APP_PATH_SUMMARY}, it opens already settled as skipped (${E2eSkipCode.NoAppLogicChange}) and ` +
      `needs nothing more. Otherwise settle it with the E2E run of this PR's own change (a wave's PRs share ` +
      `one run; any other PR gets its own), or by recording why E2E does not apply from this PR's working tree.\n`;
  const ctx =
    `A pull request was just opened: ${url}\n` +
    slotNote +
    `Per the autoWatchPR preference, a muggle-pr-followup watcher should handle its incoming reviews. ` +
    `If autoWatchPR=always, start it now by invoking ${muggleSkill("/muggle:muggle-pr-followup")} with the PR URL; ` +
    `if =ask, offer it to the user; if =never, do nothing.`;
  return envelope("PostToolUse", ctx, host);
}

function prTerminal(): string {
  // Reopen first: it retracts a close, so a close+reopen within one tool output
  // must settle as open rather than arming a handoff for a live change.
  const reopenedPrNumber = detectPrReopened(input);
  if (reopenedPrNumber !== null) {
    commitStateMutation(sessionId, { kind: StateMutationKind.PrReopened, prNumber: reopenedPrNumber }, readState(sessionId));
    return "{}";
  }
  const terminalEvent = detectPrTerminal(input);
  if (!terminalEvent) return "{}";
  const state = readState(sessionId);
  // Unchanged means the handoff is already armed or done for this PR, so there is nothing to announce.
  const terminalMutation = { kind: StateMutationKind.PrTerminal, prNumber: terminalEvent.prNumber } as const;
  if (commitStateMutation(sessionId, terminalMutation, state) === state) return "{}";
  const ctx =
    `PR #${terminalEvent.prNumber} went terminal (${terminalEvent.verdict}). Run the post-merge handoff now: ` +
    `finalize the watcher slot, tear down per autoCleanup, then OFFER NEXT OPTIONS to the user ` +
    `${nextOptionsOfferMethod(isOfferAskedInClosingMessage())} — release, queued work, deferred items. ` +
    `The stop gate holds until the offer runs.`;
  return envelope("PostToolUse", ctx, host);
}

function offerRan(): string {
  if (!(NEXT_OPTIONS_OFFER_TOOL_NAMES as readonly string[]).includes(input.tool_name ?? "")) return "{}";
  commitStateMutation(sessionId, { kind: StateMutationKind.NextOptionsOffered }, readState(sessionId));
  return "{}";
}

function terminalGate(): string {
  const pendingState = readState(sessionId);
  const isAskedInClosingMessage = isOfferAskedInClosingMessage();
  // Where the offer is the closing question rather than a tool call, the turn
  // that asks it is the offer: the gate's only exit, applied at the turn end.
  const state =
    isAskedInClosingMessage && closingMessageAsksUser(closingAssistantText())
      ? commitStateMutation(sessionId, { kind: StateMutationKind.NextOptionsOffered }, pendingState)
      : pendingState;
  const decision = prTerminalGateDecision(state);
  if (decision.action === PrTerminalGateAction.Release) return releaseGate("terminalReleased");
  if (decision.action !== PrTerminalGateAction.Block) return "{}";
  recordGateBlock("terminalBlockCount", decision.blockCount);
  const pendingPrList = (state.terminalPending ?? []).map((prNumber) => `#${prNumber}`).join(", ");
  // Full instruction once; repeats are one line (same rationale as e2eGate).
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. PR ${pendingPrList} went terminal (merged/closed) but the post-merge ` +
        `handoff has not run. Finalize the watcher slot, tear down per autoCleanup, then offer next ` +
        `options to the user ${nextOptionsOfferMethod(isAskedInClosingMessage)} — release, queued work, ` +
        `deferred items. Only that offer clears this gate.`
      : `Post-merge handoff still owed for PR ${pendingPrList} (reminder ${decision.blockCount}/${MAX_PR_TERMINAL_BLOCKS}): ` +
        `finalize + tear down, then offer the next options ${nextOptionsOfferMethod(isAskedInClosingMessage)}.`;
  return blockStop(reason, host);
}

/**
 * Starts the walkthrough scan when a commit arms the gate, or after a post while it is armed, so the turn end
 * that follows reads a finished scan that saw the post.
 */
function startWalkthroughScanOnGateArming(
  stateBefore: GuardrailState,
  committed: GuardrailState,
  hasPosted: boolean = false,
): void {
  if (isWalkthroughGateArmed(committed) && (hasPosted || !isWalkthroughGateArmed(stateBefore))) {
    startBackgroundJob(GuardrailBackgroundJob.ScanWalkthroughs, [sessionId], input.cwd);
  }
}

function recordTests(): string {
  const cmd = input.tool_input?.command ?? "";
  const stateBefore = readState(sessionId);
  const judgedSkip = judgeE2eSkip(input, stateBefore);
  const acceptedSkip = judgedSkip?.accepted ? judgedSkip.skip : null;
  const walkthroughPosted = detectWalkthroughPost(input);
  // A cycle-scoped skip is never kept as the declaration, so only an
  // environment skip may move the declaration's change to this tree's.
  const isDeclaredHere = acceptedSkip !== null && !CYCLE_SCOPED_SKIP_CODES.includes(acceptedSkip.code);
  // Every input is captured now, the post's time included, so a commit deferred
  // past a contended lock records exactly what this one would have.
  const outcome: ToolOutcomeMutation = {
    kind: StateMutationKind.ToolOutcome,
    run: {
      unitTestPassed: isTestCommand(cmd) && testsPassed(input),
      e2eRan: isE2ERun(input),
      e2eSkipped: acceptedSkip !== null,
      e2eSkipCycleScoped: acceptedSkip !== null && CYCLE_SCOPED_SKIP_CODES.includes(acceptedSkip.code),
    },
    acceptedSkip: acceptedSkip,
    skipVerifiedChange: isDeclaredHere ? resolveTreeChange(input.cwd) : undefined,
    isWatchSkip: isWatchSkipMarker(cmd),
    isBuildSkip: isBuildSkipMarker(cmd),
    isWalkthroughPosted: walkthroughPosted,
    walkthroughPostedAt: Date.now(),
    walkthroughPostTargets: walkthroughPosted ? detectWalkthroughPostTargets(input) : [],
    isWalkthroughSkip: isWalkthroughSkipMarker(cmd),
    failedRunId: detectFailedRunId(input),
  };
  // Committed under the store's lock: other observers write the session's state
  // concurrently, and of two unlocked read-modify-writes the later erases the
  // earlier. A skill emit's E2E run is skillStages' to record, not this hook's.
  const next = commitStateMutation(sessionId, outcome);
  startWalkthroughScanOnGateArming(stateBefore, next, walkthroughPosted);
  if (acceptedSkip) recordSkipReasonOnPrs(next, acceptedSkip);
  // A rejected declaration is the moment the session is still trying to skip,
  // so it is the moment worth answering — naming the failed check here is what
  // stops the next attempt being the same excuse in different words.
  if (judgedSkip && !judgedSkip.accepted) {
    return envelope("PostToolUse", explainRejection(judgedSkip), host);
  }
  return "{}";
}

// A skip that only ever reaches session state is invisible the moment the
// session ends: the PR keeps an empty slot, and a reviewer cannot tell a
// deliberate skip from a cycle that forgot. Writing the stated reason into the
// designated comment is what makes the declaration outlive the session and what
// lets the CI check settle.
//
//
// Every code is verified in the working tree, so the claim is true only of that
// tree's change — its repo and checked-out branch: the PRs opened for it, and
// that branch's PR — in a watcher cycle usually opened by an earlier session,
// so not among the handled ones. Any other PR the session opened is a different
// change, often in another repo, with its own run still owed.
function recordSkipReasonOnPrs(state: GuardrailState, skip: DeclaredSkip): void {
  if (skip.code === E2eSkipCode.NoAppLogicChange) {
    startBackgroundJob(GuardrailBackgroundJob.SettleWalkthroughNoAppLogicChange, [skip.detail], input.cwd);
    return;
  }
  for (const prUrl of state.prsHandled.filter((handledPrUrl) => isPrCoveredBySkip(state, handledPrUrl))) {
    startBackgroundJob(GuardrailBackgroundJob.SettleWalkthroughSkipped, [prUrl, skip.code, skip.detail]);
  }
  startBackgroundJob(GuardrailBackgroundJob.SettleBranchWalkthroughSkipped, [skip.code, skip.detail], input.cwd);
}

function recordDelegation(): string {
  const prUrls = detectBackgroundAcceptanceDispatch(input);
  if (prUrls === null) return "{}";
  commitStateMutation(sessionId, {
    kind: StateMutationKind.E2eDelegation,
    delegation: { dispatchedAt: Date.now(), prUrls: prUrls },
  });
  return "{}";
}

function skillStages(): string {
  const skillName = resolveSkillNameFromToolInput(input.tool_input);
  if (!skillName) return "{}";
  const stagePaths = resolveSkillStagePaths(skillName, resolvePluginSkillsRoot());
  const stateBefore = readState(sessionId);
  // A muggle-test emit is also an E2E run (the clean-SKIP verdict), committed
  // here with the skill so the emit has one writer and its skill, stages and
  // run land as one record.
  const next = commitStateMutation(sessionId, {
    kind: StateMutationKind.SkillInvocation,
    skillName: skillName,
    stagePaths: stagePaths,
    emittedRun: { unitTestPassed: false, e2eRan: isE2ERun(input), e2eSkipped: false, e2eSkipCycleScoped: false },
  });
  startWalkthroughScanOnGateArming(stateBefore, next);
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
  // A host with no Read tool opens stage files through the shell (Codex: `cat`,
  // `sed -n`), so a shell command that prints one is a read too. The pre-filter
  // matches a skills-tree path anywhere in the payload, so a Read's path is
  // checked here rather than trusted.
  const filePath = input.tool_input?.file_path;
  const readPaths = filePath
    ? [filePath].filter(isSkillTreeMarkdown)
    : isShellToolCall(input)
      ? detectShellStageReads(input.tool_input?.command ?? "", input.cwd)
      : [];
  if (readPaths.length === 0) return "{}";
  // A Read that errored opened nothing, so the stage it names is still unread.
  if (callFailed(input)) return "{}";
  commitStateMutation(
    sessionId,
    { kind: StateMutationKind.StageReads, readPaths: readPaths, skillsRootDir: resolvePluginSkillsRoot() },
    readState(sessionId),
  );
  return "{}";
}

function recordStageSignals(): string {
  const cmd = input.tool_input?.command ?? "";
  const state = readState(sessionId);
  commitStateMutation(
    sessionId,
    {
      kind: StateMutationKind.StageSignals,
      isStageSkip: isStageSkipMarker(cmd),
      isClassificationSkip: isClassificationSkipMarker(cmd),
      debugSkipCommand: isDebugSkipMarker(cmd) ? cmd : undefined,
      classifiedTestCaseId: detectClassifiedTestCaseId(input),
      // Matched against the runs owed as this hook read them; evidence for a run already debugged commits nothing.
      debugEvidenceRunIds: detectDebugEvidenceRunIds(input, undebuggedFailedRuns(state)),
    },
    state,
  );
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

// Marked before the run rather than after it, so a reviewer opening the PR
// mid-run reads that the walkthrough is about to change instead of taking the
// previous run for this head's. The PR is the one on the branch of the tree
// under test, which in a worktree cycle is not the session's own directory.
function walkthroughRerunNotice(): string {
  startBackgroundJob(GuardrailBackgroundJob.NoteWalkthroughRerun, [], input.tool_input?.cwd ?? input.cwd);
  return "{}";
}

function stageGate(): string {
  const state = readState(sessionId);
  const decision = stageGateDecision(state, unreadMandatoryStages(state));
  if (decision.action === StageGateAction.Release) return releaseGate("stageReleased");
  if (decision.action !== StageGateAction.Block) return "{}";
  recordGateBlock("stageBlockCount", decision.blockCount);
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
  if (decision.action === DebugGateAction.Release) return releaseGate("debugReleased");
  if (decision.action !== DebugGateAction.Block) return "{}";
  recordGateBlock("debugBlockCount", decision.blockCount);
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
  // The release only frees the session. The PR's comment stays at the stage it
  // reached, so a reviewer still sees it waiting on the feasibility check or
  // the run, and the walkthrough check stays unsettled.
  if (decision.action === E2eGateAction.Release) return releaseGate("e2eReleased");
  if (decision.action === E2eGateAction.None) return "{}";
  recordGateBlock("e2eBlockCount", decision.blockCount);
  // Full instruction once; repeats are one line. The first block already
  // taught the model both exits, so repeating the paragraph is pure noise.
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. This session went unit-green or opened a PR, but no E2E acceptance run has happened. ` +
        `Per the autoE2ETest preference (default: always), run change-driven E2E now via ${muggleSkill("/muggle:muggle-test")}, ` +
        `then finish. To skip, run \`echo "MUGGLE_E2E_SKIP: <CODE>: <detail>"\` citing one of ` +
        `${E2E_SKIP_CODES.join(", ")}. Muggle verifies each code itself, so one that does not hold leaves this ` +
        `gate blocked. Only when no verifiable code fits and a browser run genuinely cannot exercise the change, ` +
        `cite ${E2eSkipCode.NotApplicable} with the reason — the PR shows it as your unverified judgment.`
      : `E2E acceptance run still owed (reminder ${decision.blockCount}/${MAX_E2E_BLOCKS}): ` +
        `run ${muggleSkill("/muggle:muggle-test")}, or cite a verifiable code via \`echo "MUGGLE_E2E_SKIP: <CODE>: <detail>"\`.`;
  return blockStop(reason, host);
}

function watchGate(): string {
  const state = readState(sessionId);
  const unwatchedPrUrls = findUnwatchedHandledPrs(state.prsHandled);
  const prStateScan = readPrStateScan(sessionId);
  // A provider lookup outlasts a hook, so a detached scan runs it and the next
  // turn end decides on what landed — the split the walkthrough gate uses.
  if (state.watchSkipped !== true && prsAwaitingStateScan(unwatchedPrUrls, state, prStateScan).length > 0) {
    startBackgroundJob(GuardrailBackgroundJob.ScanWatchPrStates, [sessionId]);
  }
  const decision = watchGateDecision(state, resolveOwedWatchPrs(unwatchedPrUrls, state, prStateScan));
  if (decision.action === WatchGateAction.Release) return releaseGate("watchReleased");
  if (decision.action === WatchGateAction.None) return "{}";
  recordGateBlock("watchBlockCount", decision.blockCount);
  const prList = decision.unwatched.join(", ");
  const staleMinutes = WATCH_HEARTBEAT_STALE_MS / 60_000;
  const armCommand = `${muggleSkill("/muggle:muggle-pr-followup")} ${decision.unwatched[0]}`;
  // Full instruction once; repeats are one line — same rationale as e2eGate.
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. A PR opened this session is open with no live muggle-pr-followup watch: ${prList}. ` +
        `Arm its watch per the muggle-pr-followup arming procedure (arm-watcher.md) — invoking ${armCommand} ` +
        `bootstraps it and arms it that way (add --resume when its slot already exists). A seeded slot does not ` +
        `count: only a running watch loop does, shown by a watch-heartbeat it touches every poll and that goes stale ` +
        `after ${staleMinutes} minutes (a watch armed moments ago writes it on its first poll). If the PR already ` +
        `merged or closed, end the turn again — a provider check started now clears it. If it genuinely should not ` +
        `be watched (autoWatchPR=never, handed off elsewhere), tell the user why and run ` +
        `\`echo "MUGGLE_WATCH_SKIP: <reason>"\` — that records the skip and keeps this gate quiet for the rest of the session.`
      : `PR watch still owed for ${prList} (reminder ${decision.blockCount}/${MAX_WATCH_BLOCKS}): ` +
        `arm it per arm-watcher.md via ${armCommand} (--resume when its slot exists), or record a legitimate skip via ` +
        `\`echo "MUGGLE_WATCH_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}

function owedWatchWorkLine(work: OwedWatchWork): string {
  const muggleDo = muggleSkill("/muggle-do");
  if (work.kind === OwedWatchWorkKind.Rebase) {
    return (
      `- PR #${work.prNumber} (${work.prUrl}) is behind or conflicting with its base (key ${work.dueOn}) and no rebase ` +
      `was attempted: dispatch \`${muggleDo} rebase on ${work.prUrl} slug=${work.slug}\`.`
    );
  }
  return (
    `- PR #${work.prNumber} (${work.prUrl}) has red CI on head ${work.dueOn.slice(0, 8)} and no fix was attempted: ` +
    `dispatch \`${muggleDo} fix ci <red checks> on ${work.prUrl} slug=${work.slug}\` — the tick ` +
    `\`${muggleSkill("/muggle:muggle-pr-followup")} ${work.slug} ${work.prNumber} --wake=follow-through\` names the checks.`
  );
}

function watchFollowThroughGate(): string {
  const owedWork = findOwedWatchWork(sessionId, resolveWatchPreferences());
  const stateBefore = readState(sessionId);
  // A hold is read only when it could change the answer, and kept once read, so a hold typed long ago still counts
  // after it scrolls out of the tail.
  const transcriptTail =
    watchFollowThroughDecision(stateBefore, owedWork).action === WatchFollowThroughAction.Block && input.transcript_path
      ? readFileTail(input.transcript_path, WATCH_HOLD_TRANSCRIPT_TAIL_BYTES)
      : null;
  const heldPrNumbers = transcriptTail ? heldPrNumbersIn(transcriptTail) : [];
  const state = applyWatchHolds(stateBefore, heldPrNumbers);
  const decision = watchFollowThroughDecision(state, owedWork);
  if (decision.action === WatchFollowThroughAction.None) {
    // Reset so the next episode opens with the full instruction again.
    if (state !== stateBefore || (state.watchFollowThroughBlockCount ?? 0) > 0) {
      commitStateMutation(sessionId, {
        kind: StateMutationKind.WatchFollowThrough,
        heldPrNumbers: heldPrNumbers,
        blockCount: 0,
      });
    }
    return "{}";
  }
  commitStateMutation(sessionId, {
    kind: StateMutationKind.WatchFollowThrough,
    heldPrNumbers: heldPrNumbers,
    blockCount: decision.blockCount,
  });
  const owedList = decision.owed.map(owedWatchWorkLine).join("\n");
  const holdInstruction =
    `Only the user can hold it: their own message containing \`${WATCH_HOLD_PHRASE_PREFIX}<pr-number>\` for that PR. ` +
    `Ask if you must; never decide it for them.`;
  // Full instruction once per episode; repeats are short — same rationale as e2eGate.
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. A muggle-pr-followup watch this session owns found work due that nothing acted on:\n` +
        `${owedList}\n` +
        `autoRebase=always makes a due rebase binding, and how long a CI run or an eval takes is never a reason to ` +
        `wait. Act now — if the tick finds actionable review feedback it dispatches that first. A recorded attempt ` +
        `(conflict_resolve_attempts / ci_fix_attempts) or a new head clears this; an escalation entry with no attempt ` +
        `behind it does not, and neither does re-arming the watch. ${holdInstruction}`
      : `Watcher work still owed (reminder ${decision.blockCount}):\n${owedList}\n${holdInstruction}`;
  return blockStop(reason, host);
}

function buildFollowthroughGate(): string {
  const state = readState(sessionId);
  const decision = buildFollowthroughDecision(state);
  if (decision.action === BuildFollowthroughAction.Release) return releaseGate("buildSkipped");
  if (decision.action === BuildFollowthroughAction.None) return "{}";
  recordGateBlock("buildBlockCount", decision.blockCount);
  // Full instruction once; repeats are one line — same rationale as e2eGate.
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. This session took a build/implement/fix request but no PR was opened. ` +
        `A root cause written into the transcript ships nothing — once the session ends it is gone, and the ` +
        `watcher gate never fires because it only looks at PRs that exist. Carry the work to a PR via ` +
        `${muggleSkill("/muggle-do")}, which runs requirements → build → impact → unit tests → E2E → PR → watcher. ` +
        `If no PR is owed here (the user changed their mind, the fix landed in another repo, the answer was ` +
        `advice rather than a change), tell the user why and run \`echo "MUGGLE_BUILD_SKIP: <reason>"\` — ` +
        `that records the skip and keeps this gate quiet for the rest of the session.`
      : `Build request still unanswered — no PR opened (reminder ${decision.blockCount}/${MAX_BUILD_BLOCKS}): ` +
        `carry it to a PR via ${muggleSkill("/muggle-do")}, or record a legitimate skip via \`echo "MUGGLE_BUILD_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}

function walkthroughGate(): string {
  const state = readState(sessionId);
  if (!isWalkthroughGateArmed(state)) return "{}";
  // The provider lookups take longer than a hook may run, so a detached scan
  // does them and the gate decides on the last one that landed. Each turn end
  // queues a fresh scan for the next; until one exists for these PRs the gate
  // stays open, as it does whenever it cannot check.
  const scan = readWalkthroughScan(sessionId);
  startBackgroundJob(GuardrailBackgroundJob.ScanWalkthroughs, [sessionId], input.cwd);
  if (!scan || !isWalkthroughScanCurrent(scan, state)) return "{}";
  // A post this session was seen making settles its PR even before the provider
  // shows it, so a scan that read the PR a moment too early cannot block on it.
  const unposted = withoutPostedPrs(scan.owed, state);
  if (unposted.length === 0) {
    // Cache what was found, so later turn ends settle from state and never
    // repeat the provider lookups — until another PR opens. A skip's record gets
    // its own flag: marking every PR verified would also mute the gate for a run
    // made later.
    if (scan.verified.length + scan.owed.length > 0) {
      commitStateMutation(
        sessionId,
        {
          kind: StateMutationKind.Fields,
          fields: state.e2eRun === true ? { walkthroughsVerified: true } : { e2eSkipSettledOnPrs: true },
        },
        state,
      );
    }
    return "{}";
  }
  const decision = walkthroughGateDecision(state, withoutDelegatedPrs(unposted, state, Date.now()));
  if (decision.action === WalkthroughGateAction.Release) return releaseGate("walkthroughReleased");
  if (decision.action !== WalkthroughGateAction.Block) return "{}";
  recordGateBlock("walkthroughBlockCount", decision.blockCount);
  // A PR the skip was applied to owes the skip's record; every other PR owes the run of its own change.
  const declaredSkip = state.e2eSkipDeclaration;
  const skipOwedPrUrls = declaredSkip ? decision.owed.filter((prUrl) => isPrCoveredBySkip(state, prUrl)) : [];
  if (declaredSkip && skipOwedPrUrls.length > 0) {
    return blockOnUnsettledSkip(declaredSkip, skipOwedPrUrls, decision.blockCount);
  }
  const prList = decision.owed.join(", ");
  // Full instruction once; repeats are one line — same rationale as e2eGate.
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. No visual walkthrough or skip record has reached ${prList}. ` +
        `Each PR carries the run of its own change — a wave's PRs share one run, ` +
        `every other PR gets its own — so never post one change's run to another change's PR. If this PR's ` +
        `change was tested, post that run now per the postPRVisualWalkthrough preference (default: always) ` +
        `via ${muggleSkill("/muggle:muggle-pr-visual-walkthrough")} — include the failed runs, which are the ones ` +
        `reviewers most need to see. If it was not, run E2E for it first: inline via ` +
        `${muggleSkill("/muggle:muggle-test")}, or in a background muggle:acceptance-tester per ` +
        `do/background-e2e.md while other work continues — or, where E2E cannot apply to it, declare the ` +
        `skip from that PR's own working tree, since a skip settles only the PRs of the repo and branch it ` +
        `was verified on. If this result genuinely should not be posted ` +
        `(postPRVisualWalkthrough=never, someone else's PR, nothing renderable), tell the user why and run ` +
        `\`echo "MUGGLE_WALKTHROUGH_SKIP: <reason>"\` — that records the skip and keeps this gate quiet ` +
        `for the rest of the session.`
      : `Walkthrough still owed for ${prList} (reminder ${decision.blockCount}/${MAX_WALKTHROUGH_BLOCKS}): ` +
        `post that PR's own run via ${muggleSkill("/muggle:muggle-pr-visual-walkthrough")}, run E2E for it ` +
        `first if its change was never tested, or record a legitimate skip via ` +
        `\`echo "MUGGLE_WALKTHROUGH_SKIP: <reason>"\`.`;
  return blockStop(reason, host);
}

// The write that carries a skip to the PR runs detached, and on Windows a
// detached child can die with the hook that started it, leaving no trace. So
// the block hands over the same job to run in the foreground, where its result
// is visible, and queues it again in the background for good measure. The
// command names the session rather than quoting the skip's free text, so it
// pastes unchanged into bash or PowerShell.
function blockOnUnsettledSkip(owedSkip: DeclaredSkip, owedPrUrls: string[], blockCount: number): string {
  for (const prUrl of owedPrUrls) {
    startBackgroundJob(GuardrailBackgroundJob.SettleWalkthroughSkipped, [prUrl, owedSkip.code, owedSkip.detail]);
  }
  const settleCommands = owedPrUrls
    .map((prUrl) => `\`echo '{}' | node "${process.argv[1]}" ${GuardrailBackgroundJob.SettleWalkthroughSkipped} ${prUrl} ${sessionId}\``)
    .join(" and ");
  const reason =
    blockCount === 1
      ? `Do not end the turn yet. E2E was skipped (${owedSkip.code}) and the skip was recorded, but it has not ` +
        `reached ${owedPrUrls.join(", ")}: the PR's walkthrough comment still shows no result and no reason, so ` +
        `reviewers cannot tell a deliberate skip from a cycle that forgot, and its walkthrough check stays red. ` +
        `Write it now by running ${settleCommands} — it prints {"settled":true} once the PR shows the skip. ` +
        `Then end the turn.`
      : `Skip record still missing on ${owedPrUrls.join(", ")} (reminder ${blockCount}/${MAX_WALKTHROUGH_BLOCKS}): ` +
        `run ${settleCommands}.`;
  return blockStop(reason, host);
}

function slotForSession(state: GuardrailState): string | undefined {
  for (const prUrl of state.prsHandled) {
    const slotPath = resolveSlotForPr(prUrl);
    if (slotPath) return slotPath;
  }
  return undefined;
}

function recordCommentReplies(): string {
  const cmd = input.tool_input?.command ?? "";
  const state = readState(sessionId);
  const slotPath = slotForSession(state);
  if (!slotPath) return "{}";

  if (isReplySkipMarker(cmd)) {
    // A deferral is recorded in the ledger, not in session state, so a thread
    // the round handed back to the user stays settled after this session ends.
    // Naming no known comment falls back to a session-wide skip, so a round with
    // no usable id still has a way out.
    const deferred = deferredCommentIds(readLedger(slotPath), cmd);
    if (deferred.length === 0) {
      commitStateMutation(sessionId, { kind: StateMutationKind.Fields, fields: { commentReplySkipped: true } });
      return "{}";
    }
    for (const { threadId, commentIds } of deferred) {
      commitThread(slotPath, threadId, (entry) => coverComments(entry, commentIds, null));
    }
    return "{}";
  }

  for (const thread of detectUnansweredThreads(input)) {
    commitThread(slotPath, thread.threadId, (entry) =>
      claimThread(
        refreshHumanComments({ ...entry, provider: thread.provider }, thread.humanCommentIds),
        sessionId,
      ),
    );
  }

  const confirmed = detectConfirmedReplies(input);
  if (confirmed.length > 0) {
    const ledger = readLedger(slotPath);
    for (const reply of confirmed) {
      const threadId = threadForReplyTarget(ledger, reply.targetId);
      if (!threadId) continue;
      // A GitLab note answers the whole discussion, so its target is the thread
      // itself and every comment still open in it is what the reply covered.
      const covered =
        threadId === reply.targetId
          ? uncoveredComments(ledger.threads[threadId])
          : [reply.targetId];
      commitThread(slotPath, threadId, (entry) => coverComments(entry, covered, reply.replySha));
    }
  }
  return "{}";
}

function commentReplyGate(): string {
  const state = readState(sessionId);
  const slotPath = slotForSession(state);
  if (!slotPath) return "{}";
  const decision = commentReplyGateDecision(state, overdueThreads(slotPath, sessionId));
  if (decision.action === CommentReplyGateAction.Release) return releaseGate("commentReplyReleased");
  if (decision.action !== CommentReplyGateAction.Block) return "{}";
  recordGateBlock("commentReplyBlockCount", decision.blockCount);
  const commentList = decision.unanswered.join(", ");
  // Full instruction once; repeats are one line (same rationale as e2eGate).
  const reason =
    decision.blockCount === 1
      ? `Do not end the turn yet. This session took these review comments as work and never ` +
        `answered them: ${commentList}. Post one reply per comment in its own thread per ` +
        `muggle-do do/per-comment-replies.md — "Addressed in <short-sha>: <what changed for THIS ` +
        `comment>", signed via sign-body.sh --mode loop. A silent round leaves the reviewer with no ` +
        `answer in the thread, and the loop marker that reply carries is the only thing that stops ` +
        `the watcher re-dispatching the same thread next tick. If a comment was escalated to the ` +
        `user instead of answered, record it as deferred rather than replying.`
      : `Review comments still owe a threaded reply (reminder ${decision.blockCount}/${MAX_REPLY_BLOCKS}): ` +
        `${commentList}. Reply per do/per-comment-replies.md, or record the deferral.`;
  return blockStop(reason, host);
}

function reportGate(): string {
  const reportPostVerdict = evaluateReportPost(input);
  if (!reportPostVerdict.deny || !reportPostVerdict.reason) return "{}";
  return denyTool(reportPostVerdict.reason, host);
}

function walkthroughHeadingGate(): string {
  const headingVerdict = evaluateWalkthroughHeadingPost(input, readState(sessionId));
  if (!headingVerdict.deny || !headingVerdict.reason) return "{}";
  return denyTool(headingVerdict.reason, host);
}

function resolveGate(): string {
  const resolveVerdict = evaluateReviewThreadResolve(input);
  if (!resolveVerdict.deny || !resolveVerdict.reason) return "{}";
  return denyTool(resolveVerdict.reason, host);
}

function buildRouter(): string {
  const prompt = input.prompt ?? "";
  const isMuggleDoInvoked = isMuggleDoForwardInvocation(prompt);
  if (!isMuggleDoInvoked && !detectBuildIntent(prompt)) return "{}";
  if (readState(sessionId).buildIntentRouted) return "{}";
  commitStateMutation(sessionId, { kind: StateMutationKind.Fields, fields: { buildIntentRouted: true } });
  // The user already chose the pipeline the advisory would offer; only the follow-through is armed.
  if (isMuggleDoInvoked) return "{}";
  const ctx =
    `This looks like a build/implement/fix request. Per the autoRouteBuildToMuggleDo preference, ` +
    `route it through ${muggleSkill("/muggle-do")} — which runs requirements → build (delegated to superpowers' ` +
    `design→plan→review) → impact → unit tests → E2E → PR → watcher. ` +
    `If autoRouteBuildToMuggleDo=always, enter that flow; if =ask, offer it; if =never, proceed normally.`;
  return envelope("UserPromptSubmit", ctx, host);
}

// The closing message a Stop hook judges: the payload's own copy when the host
// sends one (Codex always does), else the last assistant turn of the Claude Code
// transcript — a format Codex's own transcript does not share.
function closingAssistantText(): string {
  if (typeof input.last_assistant_message === "string") return input.last_assistant_message;
  const transcriptPath = input.transcript_path;
  if (!transcriptPath) return "";
  try {
    return lastAssistantText(
      readFileSync(transcriptPath, "utf-8").slice(-CAPABILITY_CLAIM_TRANSCRIPT_TAIL_BYTES),
    );
  } catch {
    return "";
  }
}

function capabilityClaimGate(): string {
  if (readState(sessionId).capabilityClaimNudged) return "{}";
  if (!detectFalseCapabilityClaim(closingAssistantText())) return "{}";
  commitStateMutation(sessionId, { kind: StateMutationKind.Fields, fields: { capabilityClaimNudged: true } });
  const reason =
    `Do not end the turn yet. This turn tells the user that a login- or code-gated flow cannot be ` +
    `tested, reached, or verified — the one class of blocker Muggle clears. Every managed login profile ` +
    `owns a live inbox, so magic-link and sign-in-link logins, emailed OTPs, email-based 2FA, ` +
    `verification mail, and password resets run end to end with no mail stub and no test-only backdoor. ` +
    `An SMS code is read from the profile's provisioned number, an authenticator code is derived offline ` +
    `from its stored TOTP secret, and stored credentials and CAPTCHA solving are covered too. Re-read ` +
    `plugin/skills/_shared/identity-and-inbox.md, then correct the claim or run the flow. Genuine limits ` +
    `stay sayable: a voice call, an OAuth-only provider, or an account with no phone number provisioned ` +
    `(the runner cannot mint one) — name the one that applies and move on.`;
  return blockStop(reason, host);
}

/**
 * `run <subcommand...>`: every gate guardrail-dispatch.sh's pre-filters let through, in one
 * process, merged into one response. Each gate is isolated so a throwing handler cannot
 * silence the rest — the never-block guarantee each gate's own bash fallback used to give.
 */
function runFiringGates(): string {
  const gateOutputs = process.argv.slice(3).map((firingSubcommand) => {
    try {
      return (handlers[firingSubcommand] ?? (() => "{}"))();
    } catch {
      return "{}";
    }
  });
  return mergeHookOutputs(gateOutputs, host);
}

const handlers: Record<string, () => string> = {
  run: runFiringGates,
  "pr-opened": prOpened,
  "capability-claim-gate": capabilityClaimGate,
  "pr-terminal": prTerminal,
  "offer-ran": offerRan,
  "record-tests": recordTests,
  "record-delegation": recordDelegation,
  "e2e-gate": e2eGate,
  "terminal-gate": terminalGate,
  "watch-gate": watchGate,
  "watch-follow-through-gate": watchFollowThroughGate,
  "build-followthrough-gate": buildFollowthroughGate,
  "walkthrough-gate": walkthroughGate,
  "record-comment-replies": recordCommentReplies,
  "comment-reply-gate": commentReplyGate,
  "report-gate": reportGate,
  "walkthrough-heading-gate": walkthroughHeadingGate,
  "resolve-gate": resolveGate,
  "build-router": buildRouter,
  "skill-stages": skillStages,
  "record-stage-read": recordStageRead,
  "record-stage-signals": recordStageSignals,
  "classify-gate": classifyGate,
  "walkthrough-rerun-notice": walkthroughRerunNotice,
  "stage-gate": stageGate,
  "debug-path-gate": debugPathGate,
};

const jobArgs = process.argv.slice(3);

function scanWalkthroughsJob(): string {
  const scannedSessionId = jobArgs[0] ?? "unknown";
  const startedAt = Date.now();
  const state = readState(scannedSessionId);
  const scan = scanForOwedWalkthroughs(state);
  writeWalkthroughScan(scannedSessionId, {
    prsHandled: state.prsHandled,
    owed: scan.owed,
    verified: scan.verified,
    startedAt: startedAt,
  });
  return "{}";
}

function reserveWalkthroughCommentJob(): string {
  const [prUrl] = jobArgs;
  if (prUrl) reserveWalkthroughComment(prUrl);
  return "{}";
}

// Takes the skip either as `<code> <detail>`, as the hooks pass it, or as a
// session id, as the walkthrough gate's instruction does — that form needs no
// quoting of the detail and can only settle a skip the session already had
// accepted. Prints whether the PR now shows a settled record, checked by
// reading it back, so a foreground run can prove the write landed.
function settleWalkthroughSkippedJob(): string {
  const [prUrl, codeOrSessionId, detail] = jobArgs;
  const code = E2E_SKIP_CODES.find((skipCode) => skipCode === codeOrSessionId);
  const skip = code
    ? { code: code, detail: detail ?? "" }
    : codeOrSessionId
      ? readState(codeOrSessionId).e2eSkipDeclaration
      : undefined;
  if (!prUrl || !skip) return JSON.stringify({ settled: false, reason: "no accepted E2E skip to settle" });
  settleWalkthroughCommentAsSkipped(prUrl, skip.code, skip.detail);
  return JSON.stringify({ settled: isWalkthroughSettledOnPr(prUrl) });
}

// Started in the working tree the skip was verified in, whose checked-out
// branch names the PR: a hook cannot resolve that PR itself within its budget.
function settleBranchWalkthroughSkippedJob(): string {
  const [codeArg, detail] = jobArgs;
  const code = E2E_SKIP_CODES.find((skipCode) => skipCode === codeArg);
  if (!code) return "{}";
  const prUrl = defaultPrWalkthroughLookup.branchPrUrl();
  if (prUrl) settleWalkthroughCommentAsSkipped(prUrl, code, detail ?? "");
  return "{}";
}

function settleWalkthroughNoAppLogicChangeJob(): string {
  const [detail] = jobArgs;
  const prUrl = defaultPrWalkthroughLookup.branchPrUrl();
  if (prUrl && detail) settleWalkthroughCommentForNoAppLogicChange(prUrl, detail);
  return "{}";
}

function noteWalkthroughRerunJob(): string {
  const prUrl = defaultPrWalkthroughLookup.branchPrUrl();
  if (prUrl) noteE2eRunStarted(prUrl);
  return "{}";
}

function scanWatchPrStatesJob(): string {
  const scannedSessionId = jobArgs[0] ?? "unknown";
  const state = readState(scannedSessionId);
  const previousScan = readPrStateScan(scannedSessionId);
  const awaitingPrUrls = prsAwaitingStateScan(findUnwatchedHandledPrs(state.prsHandled), state, previousScan);
  if (awaitingPrUrls.length === 0) return "{}";
  // Merged over the previous scan so a PR already settled as merged keeps its entry.
  const freshScan = scanProviderPrStates(awaitingPrUrls);
  writePrStateScan(scannedSessionId, { states: { ...previousScan?.states, ...freshScan.states } });
  return "{}";
}

function commitDeferredStateJob(): string {
  commitDeferredSessionState(jobArgs[0] ?? "unknown");
  return "{}";
}

const backgroundJobs: Record<GuardrailBackgroundJob, () => string> = {
  [GuardrailBackgroundJob.ScanWalkthroughs]: scanWalkthroughsJob,
  [GuardrailBackgroundJob.ReserveWalkthroughComment]: reserveWalkthroughCommentJob,
  [GuardrailBackgroundJob.SettleWalkthroughSkipped]: settleWalkthroughSkippedJob,
  [GuardrailBackgroundJob.SettleBranchWalkthroughSkipped]: settleBranchWalkthroughSkippedJob,
  [GuardrailBackgroundJob.SettleWalkthroughNoAppLogicChange]: settleWalkthroughNoAppLogicChangeJob,
  [GuardrailBackgroundJob.NoteWalkthroughRerun]: noteWalkthroughRerunJob,
  [GuardrailBackgroundJob.ScanWatchPrStates]: scanWatchPrStatesJob,
  [GuardrailBackgroundJob.CommitDeferredState]: commitDeferredStateJob,
};

const runSubcommand = isBackgroundJob(sub) ? backgroundJobs[sub] : (handlers[sub] ?? (() => "{}"));
process.stdout.write(runSubcommand());
