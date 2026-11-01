import { existsSync } from "fs";
import { findClaudeSessionCwd } from "./claude-transcripts.js";
import { LIMIT_RESUME_MAX_ATTEMPTS, LIMIT_RESUME_PROMPT, LIMIT_RESUME_WINDOW_MS, LIMIT_STOP_MAX_AGE_MS } from "./constants.js";
import { shortSessionId } from "./format.js";
import { hasLiveProcess } from "./session-liveness.js";
import { resumeSession } from "./session-restart.js";
import {
  ClaudeSessionKind,
  ClaudeTurnStatus,
  LimitResumeAction,
  SessionResumeOutcome,
  WatcherRecoveryOutcome,
  WatchEventKind,
  WorkSessionAgent,
  type LimitResumeAttempt,
  type LimitResumeDecision,
  type LimitStop,
  type RecoveryExecutionDeps,
  type SessionResumeResult,
  type WatchEvent,
  type WorkSession,
} from "./types.js";

function recentAttempts(attempts: LimitResumeAttempt[], nowMs: number): LimitResumeAttempt[] {
  return attempts.filter((attempt) => nowMs - Date.parse(attempt.at) < LIMIT_RESUME_WINDOW_MS);
}

function decide(session: WorkSession, stop: LimitStop, action: LimitResumeAction, reason: string): LimitResumeDecision {
  return {
    sessionId: session.sessionId,
    ...(session.shortId === undefined ? {} : { shortId: session.shortId }),
    ...(session.name === undefined ? {} : { name: session.name }),
    action: action,
    reason: reason,
    noticeUuid: stop.noticeUuid,
  };
}

/**
 * What to do with each Claude session whose last turn ended on a usage-limit
 * notice: continue it once that limit has reset and the account has room
 * again, in place and between turns only, or say why not. A notice already
 * continued, or older than `LIMIT_STOP_MAX_AGE_MS`, gets no decision at all.
 *
 * @param limitStopsBySessionId - The notice each limit-stopped session ended on.
 * @param isUsageLimitInForce - Whether Claude's usage cache shows a window still exhausted.
 * @param maxContinues - Continues this tick may still make.
 * Output shape: `[{ sessionId: "b6c05c96-…", shortId: "b6c05c96", action: "continue", reason: "limit reset at 2026-10-29T21:20:00.000Z", noticeUuid: "8a8159d6-…" }]`
 */
export function planLimitResumes(
  sessions: WorkSession[],
  limitStopsBySessionId: Map<string, LimitStop>,
  attemptsBySession: Record<string, LimitResumeAttempt[]>,
  nowMs: number,
  isUsageLimitInForce: boolean,
  maxContinues: number,
): LimitResumeDecision[] {
  const decisions: LimitResumeDecision[] = [];
  let continueCount = 0;
  for (const session of sessions) {
    const stop = limitStopsBySessionId.get(session.sessionId);
    if (session.agent !== WorkSessionAgent.Claude || stop === undefined) continue;
    const attempts = attemptsBySession[session.sessionId] ?? [];
    if (nowMs - stop.noticedAtMs > LIMIT_STOP_MAX_AGE_MS) continue;
    if (attempts.some((attempt) => attempt.noticeUuid === stop.noticeUuid && attempt.isContinued)) continue;
    const isRunning = hasLiveProcess(session);
    if (session.kind !== ClaudeSessionKind.Background) {
      decisions.push(decide(session, stop, LimitResumeAction.Skip, "terminal session, continue it there"));
    } else if (session.shortId === undefined) {
      decisions.push(decide(session, stop, LimitResumeAction.Skip, "no short id to continue it by"));
    } else if (isRunning && session.turnStatus !== ClaudeTurnStatus.Idle) {
      decisions.push(decide(session, stop, LimitResumeAction.Skip, `turn in flight (${session.turnStatus ?? "unknown"})`));
    } else if (stop.resetsAtMs !== undefined && stop.resetsAtMs > nowMs) {
      decisions.push(decide(session, stop, LimitResumeAction.Wait, `limit resets at ${new Date(stop.resetsAtMs).toISOString()}`));
    } else if (isUsageLimitInForce) {
      decisions.push(decide(session, stop, LimitResumeAction.Wait, "the account is still at a usage limit"));
    } else if (recentAttempts(attempts, nowMs).length >= LIMIT_RESUME_MAX_ATTEMPTS) {
      decisions.push(decide(session, stop, LimitResumeAction.Skip, `after ${LIMIT_RESUME_MAX_ATTEMPTS} tries today`));
    } else if (continueCount >= maxContinues) {
      decisions.push(decide(session, stop, LimitResumeAction.Wait, "tick cap reached"));
    } else {
      continueCount++;
      const reason = stop.resetsAtMs === undefined ? "usage limit cleared" : `limit reset at ${new Date(stop.resetsAtMs).toISOString()}`;
      decisions.push({ ...decide(session, stop, LimitResumeAction.Continue, reason), ...(isRunning ? { runningShortId: session.shortId } : {}) });
    }
  }
  return decisions;
}

function continuedOutcomeOf(outcome: SessionResumeOutcome): WatcherRecoveryOutcome {
  if (outcome === SessionResumeOutcome.Continued) return WatcherRecoveryOutcome.Resumed;
  return outcome === SessionResumeOutcome.Copied ? WatcherRecoveryOutcome.ResumeForked : WatcherRecoveryOutcome.ResumeFailed;
}

function eventKindOf(outcome: WatcherRecoveryOutcome): WatchEventKind {
  if (outcome === WatcherRecoveryOutcome.Resumed) return WatchEventKind.Resumed;
  if (outcome === WatcherRecoveryOutcome.ResumeForked) return WatchEventKind.ResumeForked;
  return outcome === WatcherRecoveryOutcome.RestartRefused ? WatchEventKind.RestartRefused : WatchEventKind.ResumeFailed;
}

function continueMessageOf(resumed: SessionResumeResult, reason: string): string {
  if (resumed.outcome === SessionResumeOutcome.Continued) return `continued it after its usage limit reset (${reason})`;
  if (resumed.outcome === SessionResumeOutcome.Copied) {
    const copyNote = resumed.isCopyRemoved ? "stopped and removed the copy" : `run claude rm ${resumed.copyShortId}`;
    return `could not continue it: Claude started copy ${resumed.copyShortId} instead; ${copyNote}`;
  }
  const cause = resumed.outcome === SessionResumeOutcome.StillRunning ? "it is still running" : "the resume did not start";
  return `could not continue it after its usage limit: ${cause}`;
}

/**
 * Carry out the `continue` decisions: each session is resumed in place on the
 * one continue prompt, stopped first when it runs between turns, and only
 * where Claude will bring it back in its workspace. Every attempt is recorded,
 * so a notice is continued once and a session that cannot be is not retried
 * past the daily cap.
 *
 * Output shape: `{ decisions: [{ …, outcome: "resumed" }], attemptsBySession: { "b6c05c96-…": [{ noticeUuid: "8a81…", at: "…", isContinued: true }] }, events: [ … ] }`
 */
export function executeLimitResumes(
  planned: LimitResumeDecision[],
  attemptsBySession: Record<string, LimitResumeAttempt[]>,
  deps: RecoveryExecutionDeps,
): { decisions: LimitResumeDecision[]; attemptsBySession: Record<string, LimitResumeAttempt[]>; events: WatchEvent[] } {
  const at = new Date(deps.nowMs).toISOString();
  const nextAttemptsBySession: Record<string, LimitResumeAttempt[]> = {};
  for (const [sessionId, attempts] of Object.entries(attemptsBySession)) {
    const kept = attempts.filter((attempt) => deps.nowMs - Date.parse(attempt.at) < LIMIT_STOP_MAX_AGE_MS);
    if (kept.length > 0) nextAttemptsBySession[sessionId] = kept;
  }
  const events: WatchEvent[] = [];
  const decisions = planned.map((decision): LimitResumeDecision => {
    if (decision.action !== LimitResumeAction.Continue) return decision;
    const subject = `session ${decision.shortId ?? shortSessionId(decision.sessionId)}`;
    const cwd = findClaudeSessionCwd(deps.claudeProjectsDir, decision.sessionId);
    if (!cwd || !existsSync(cwd)) return { ...decision, outcome: WatcherRecoveryOutcome.TranscriptMissing };
    let outcome: WatcherRecoveryOutcome;
    let message: string;
    if (decision.runningShortId !== undefined && !deps.canRestartIn(cwd)) {
      outcome = WatcherRecoveryOutcome.RestartRefused;
      message = `left stopped at its usage limit: Claude would not resume it in ${cwd}`;
    } else {
      const resumed = resumeSession(
        { sessionId: decision.sessionId, cwd: cwd, prompt: LIMIT_RESUME_PROMPT, runningShortId: decision.runningShortId },
        deps.runCommand,
        deps.waitForExit,
        deps.isSessionRunning,
      );
      outcome = continuedOutcomeOf(resumed.outcome);
      message = continueMessageOf(resumed, decision.reason);
    }
    nextAttemptsBySession[decision.sessionId] = [
      ...(nextAttemptsBySession[decision.sessionId] ?? []),
      { noticeUuid: decision.noticeUuid, at: at, isContinued: outcome === WatcherRecoveryOutcome.Resumed },
    ];
    events.push({ at: at, kind: eventKindOf(outcome), subject: subject, message: message });
    return { ...decision, outcome: outcome };
  });
  return { decisions: decisions, attemptsBySession: nextAttemptsBySession, events: events };
}
