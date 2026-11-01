import { existsSync } from "fs";
import { ProviderPrState } from "../guardrails/types.js";
import { findClaudeSessionCwd } from "./claude-transcripts.js";
import {
  MAX_RESUMES_PER_TICK,
  PR_FOLLOWUP_COMMAND,
  RECOVERY_ATTEMPT_WINDOW_MS,
  RECOVERY_COOLDOWN_MS,
  RECOVERY_MAX_ATTEMPTS,
} from "./constants.js";
import { shortSessionId } from "./format.js";
import { isTerminalPrState } from "./pr-status.js";
import { isOwnerWakeReport, markServiceLoopReportDelivered } from "./service-loop.js";
import { isIdleBackgroundSession } from "./session-liveness.js";
import { resumeSession } from "./session-restart.js";
import {
  SessionResumeOutcome,
  WatcherLiveness,
  WatcherRecoveryOutcome,
  WatchEventKind,
  type ExecutedRecoveries,
  type RecoveryExecutionDeps,
  type ServiceLoopReportKind,
  type WatcherRecovery,
  type WatchEvent,
  type WatchSlotAssessment,
  type WorkSession,
} from "./types.js";

/**
 * Whether the watch may wake this slot's owner for what its loop reported.
 * Only a report from a loop the watch started counts, and only once that loop
 * has exited. A running owner is woken only between turns — never while it
 * works or waits on its user — and an ended one is resumed, unless its PR has
 * merged or closed: that slot is closed out instead, without waking anyone.
 *
 * @param ownerSession - The owner's session listing, when it is running.
 */
export function isOwnerWakeDue(assessment: WatchSlotAssessment, ownerSession?: WorkSession): boolean {
  const isOwnerEnded = ownerSession === undefined && assessment.isOwnerSessionActive === false;
  const isOwnerReachable = isOwnerEnded
    ? assessment.live?.state === ProviderPrState.Open
    : ownerSession !== undefined && isIdleBackgroundSession(ownerSession);
  return (
    assessment.isRegistered &&
    isOwnerWakeReport(assessment.serviceLoopReport) &&
    assessment.watcher !== WatcherLiveness.Polling &&
    assessment.ownerSessionId !== undefined &&
    assessment.live !== undefined &&
    (assessment.live.state === ProviderPrState.Open || isTerminalPrState(assessment.live.state)) &&
    isOwnerReachable
  );
}

/**
 * Whether the watch should close out this slot itself: GitHub reports its PR
 * merged or closed, no loop is watching it, and its owner session is not
 * running. A running owner finalizes the slot and dispatches its post-merge
 * cleanup on its own turn, and closing the slot first would make that session
 * skip the cleanup.
 */
export function isSlotCloseOutDue(assessment: WatchSlotAssessment): boolean {
  return isTerminalPrState(assessment.live?.state) && assessment.watcher === WatcherLiveness.Dead && assessment.isOwnerSessionActive !== true;
}

/**
 * The owner's running session listing. A job that continued under a new
 * transcript keeps listing under the short id it started with, so an owner
 * whose own id is no longer listed is found by that.
 */
export function findRunningOwner(sessionsById: Map<string, WorkSession>, ownerSessionId: string): WorkSession | undefined {
  const ownerShortId = shortSessionId(ownerSessionId);
  return sessionsById.get(ownerSessionId) ?? [...sessionsById.values()].find((session) => session.shortId === ownerShortId);
}

/** The one command a woken owner starts on: its own slot and PR, never a sweep of other sessions' work. */
export function composeOwnerWakePrompt(slotSlug: string, prNumber: number, reportKind: ServiceLoopReportKind): string {
  return `${PR_FOLLOWUP_COMMAND} ${slotSlug} ${prNumber} --wake=${reportKind}`;
}

/**
 * At most one wake per owner session per tick, for the first of its slots with
 * a report waiting; the rest wait for later ticks, after that wake's turn. Only
 * failed wakes count toward the cooldown and cap, since a delivered report is
 * set aside and never wakes anyone twice. While the account sits at a usage
 * limit nothing is woken or counted.
 *
 * Output shape: `[{ ownerSessionId: "349a…", slotSlug: "csv-export", slotDir: "…", prNumber: 7, reportKind: "event", outcome: "resume-due", ownerShortId: "349a8d3f" }]`
 *
 * @param sessionsById - Running sessions, so a live owner can be judged idle.
 * @param isUsageLimitInForce - Whether the account is at a usage limit that has not reset yet.
 */
export function planWatcherRecoveries(
  assessments: WatchSlotAssessment[],
  attemptsByOwner: Record<string, string[]>,
  nowMs: number,
  isPollingDisabled: boolean,
  sessionsById: Map<string, WorkSession> = new Map(),
  isUsageLimitInForce = false,
): WatcherRecovery[] {
  if (isPollingDisabled) return [];
  const dueByOwner = new Map<string, WatchSlotAssessment>();
  for (const assessment of [...assessments].sort((left, right) => left.slug.localeCompare(right.slug))) {
    const ownerSession = assessment.ownerSessionId === undefined ? undefined : findRunningOwner(sessionsById, assessment.ownerSessionId);
    if (!isOwnerWakeDue(assessment, ownerSession)) continue;
    const ownerSessionId = assessment.ownerSessionId as string;
    if (!dueByOwner.has(ownerSessionId)) dueByOwner.set(ownerSessionId, assessment);
  }
  let resumesPlanned = 0;
  const recoveries: WatcherRecovery[] = [];
  for (const ownerSessionId of [...dueByOwner.keys()].sort()) {
    const assessment = dueByOwner.get(ownerSessionId) as WatchSlotAssessment;
    const recentAttemptsMs = (attemptsByOwner[ownerSessionId] ?? [])
      .map((attemptedAt) => Date.parse(attemptedAt))
      .filter((attemptedAtMs) => !Number.isNaN(attemptedAtMs) && nowMs - attemptedAtMs < RECOVERY_ATTEMPT_WINDOW_MS);
    const lastAttemptMs = Math.max(-Infinity, ...recentAttemptsMs);
    const runningOwner = findRunningOwner(sessionsById, ownerSessionId);
    let outcome = WatcherRecoveryOutcome.ResumeDue;
    if (isUsageLimitInForce) outcome = WatcherRecoveryOutcome.AwaitingUsageLimitReset;
    else if (recentAttemptsMs.length >= RECOVERY_MAX_ATTEMPTS) outcome = WatcherRecoveryOutcome.AttemptsExhausted;
    else if (nowMs - lastAttemptMs < RECOVERY_COOLDOWN_MS) outcome = WatcherRecoveryOutcome.CoolingDown;
    else if (resumesPlanned >= MAX_RESUMES_PER_TICK) outcome = WatcherRecoveryOutcome.DeferredByTickCap;
    if (outcome === WatcherRecoveryOutcome.ResumeDue) resumesPlanned++;
    recoveries.push({
      ownerSessionId: ownerSessionId,
      slotSlug: assessment.slug,
      slotDir: assessment.slotDir,
      prNumber: assessment.pr.number,
      reportKind: assessment.serviceLoopReport?.kind as ServiceLoopReportKind,
      outcome: outcome,
      ...(runningOwner?.shortId === undefined ? {} : { ownerShortId: runningOwner.shortId }),
      ...(runningOwner === undefined || runningOwner.sessionId === ownerSessionId ? {} : { ownerRunningSessionId: runningOwner.sessionId }),
    });
  }
  return recoveries;
}

/**
 * Wake each due owner in the background from its own project dir, on the one
 * command that hands it its PR's report. A still-running owner is restarted
 * only where `canRestartIn` confirms Claude will bring it back. A delivered
 * report is set aside; a failed or refused wake is counted, so it is retried
 * only after the cooldown. Anything not due passes through as planned.
 */
export function executeWatcherRecoveries(
  planned: WatcherRecovery[],
  attemptsByOwner: Record<string, string[]>,
  deps: RecoveryExecutionDeps,
): ExecutedRecoveries {
  const nowIso = new Date(deps.nowMs).toISOString();
  const nextAttemptsByOwner: Record<string, string[]> = {};
  for (const [ownerSessionId, attempts] of Object.entries(attemptsByOwner)) {
    const recent = attempts.filter((attemptedAt) => deps.nowMs - Date.parse(attemptedAt) < RECOVERY_ATTEMPT_WINDOW_MS);
    if (recent.length > 0) nextAttemptsByOwner[ownerSessionId] = recent;
  }
  const countAttempt = (ownerSessionId: string): void => {
    nextAttemptsByOwner[ownerSessionId] = [...(nextAttemptsByOwner[ownerSessionId] ?? []), nowIso];
  };
  const events: WatchEvent[] = [];
  const recoveries = planned.map((recovery): WatcherRecovery => {
    if (recovery.outcome !== WatcherRecoveryOutcome.ResumeDue) return recovery;
    const cwd = findClaudeSessionCwd(deps.claudeProjectsDir, recovery.ownerSessionId);
    if (!cwd || !existsSync(cwd)) return { ...recovery, outcome: WatcherRecoveryOutcome.TranscriptMissing };
    const subject = `session ${shortSessionId(recovery.ownerSessionId)}`;
    const prompt = composeOwnerWakePrompt(recovery.slotSlug, recovery.prNumber, recovery.reportKind);
    if (recovery.ownerShortId !== undefined && !deps.canRestartIn(cwd)) {
      countAttempt(recovery.ownerSessionId);
      events.push({
        at: nowIso,
        kind: WatchEventKind.RestartRefused,
        subject: subject,
        message: `left running: Claude would not resume it in ${cwd}, so PR #${recovery.prNumber}'s ${recovery.reportKind} waits`,
      });
      return { ...recovery, cwd: cwd, outcome: WatcherRecoveryOutcome.RestartRefused };
    }
    const resumed = resumeSession(
      { sessionId: recovery.ownerSessionId, cwd: cwd, prompt: prompt, runningShortId: recovery.ownerShortId, runningSessionId: recovery.ownerRunningSessionId },
      deps.runCommand,
      deps.waitForExit,
      deps.isSessionRunning,
    );
    if (resumed.outcome === SessionResumeOutcome.Continued) {
      markServiceLoopReportDelivered(recovery.slotDir);
      events.push({ at: nowIso, kind: WatchEventKind.Resumed, subject: subject, message: `woke it with ${prompt}` });
      return { ...recovery, cwd: cwd, outcome: WatcherRecoveryOutcome.Resumed };
    }
    countAttempt(recovery.ownerSessionId);
    if (resumed.outcome === SessionResumeOutcome.Copied) {
      const copyNote = resumed.isCopyRemoved ? "stopped and removed the copy" : `could not remove the copy, run claude rm ${resumed.copyShortId}`;
      events.push({
        at: nowIso,
        kind: WatchEventKind.ResumeForked,
        subject: subject,
        message: `could not wake it: Claude still ran it and started copy ${resumed.copyShortId} instead; ${copyNote}`,
      });
      return { ...recovery, cwd: cwd, outcome: WatcherRecoveryOutcome.ResumeForked };
    }
    const reason = resumed.outcome === SessionResumeOutcome.StillRunning ? "it is still running, so a resume would start a copy" : `${prompt} did not start`;
    events.push({ at: nowIso, kind: WatchEventKind.ResumeFailed, subject: subject, message: `could not wake it: ${reason}` });
    return { ...recovery, cwd: cwd, outcome: WatcherRecoveryOutcome.ResumeFailed };
  });
  return { recoveries: recoveries, attemptsByOwner: nextAttemptsByOwner, events: events };
}
