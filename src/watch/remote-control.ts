import {
  REMOTE_CONTROL_MAX_RESTARTS,
  REMOTE_CONTROL_RESTART_COOLDOWN_MS,
  REMOTE_CONTROL_RESTART_WINDOW_MS,
} from "./constants.js";
import { hasLiveProcess } from "./session-liveness.js";
import {
  ClaudeProcessStatus,
  ClaudeSessionKind,
  ClaudeTurnStatus,
  ReloadAction,
  WorkSessionAgent,
  type ClaudeLoginRecord,
  type ObservedClaudeLogin,
  type ReloadDecision,
  type ReloadReport,
  type WorkSession,
} from "./types.js";

/**
 * The login record after this tick's read. A login the watch has never seen
 * before has no known start; a change between ticks took effect no earlier than
 * the previous tick and no later than now, and the credentials file's write
 * time, when there is one, pins it inside that span.
 *
 * Output shape: `{ accountUuid: "93d6918c-…", effectiveAtMs: 1793480600000, observedAtMs: 1793481000000 }`
 */
export function advanceClaudeLogin(
  previous: ClaudeLoginRecord | undefined,
  observed: ObservedClaudeLogin,
  nowMs: number,
): ClaudeLoginRecord | undefined {
  if (observed.accountUuid === undefined) return previous;
  if (previous === undefined) return { accountUuid: observed.accountUuid, observedAtMs: nowMs };
  if (previous.accountUuid === observed.accountUuid) return { ...previous, observedAtMs: nowMs };
  const writtenAtMs = Math.min(observed.credentialsWrittenAtMs ?? nowMs, nowMs);
  return { accountUuid: observed.accountUuid, effectiveAtMs: Math.max(previous.observedAtMs, writtenAtMs), observedAtMs: nowMs };
}

/**
 * Why a session is off Remote Control for the current login, or undefined when
 * it is on. A process links once, as it starts, under the login of that moment,
 * so one started before the current login took effect serves another account.
 */
export function remoteControlGapOf(session: WorkSession, login: ClaudeLoginRecord): string | undefined {
  if (session.remoteControlSessionId === undefined) return "no Remote Control link";
  const isStartedBeforeLogin =
    login.effectiveAtMs !== undefined && session.startedAtMs !== undefined && session.startedAtMs < login.effectiveAtMs;
  return isStartedBeforeLogin ? "linked under an earlier login" : undefined;
}

// A restart carries running background commands over to the new process, so a
// turn that is over is the only condition — background work included.
function isTurnOver(session: WorkSession): boolean {
  if (session.processStatus !== undefined) {
    return session.processStatus === ClaudeProcessStatus.Idle || session.processStatus === ClaudeProcessStatus.Shell;
  }
  return session.turnStatus === ClaudeTurnStatus.Idle;
}

function recentRestartsMs(restartsBySession: Record<string, string[]>, sessionId: string, nowMs: number): number[] {
  return (restartsBySession[sessionId] ?? [])
    .map((restartedAt) => Date.parse(restartedAt))
    .filter((restartedAtMs) => !Number.isNaN(restartedAtMs) && nowMs - restartedAtMs < REMOTE_CONTROL_RESTART_WINDOW_MS);
}

function decide(session: WorkSession, action: ReloadAction, reason: string): ReloadDecision {
  return { sessionId: session.sessionId, shortId: session.shortId, name: session.name, cwd: session.cwd, action: action, reason: reason };
}

/**
 * What to do with each live Claude session so every one is reachable over
 * Remote Control by the account logged in now. A restart is the only way back
 * on — the process links as it starts — and `claude respawn` keeps the session
 * id, so nothing is duplicated and nothing is typed into the conversation. It
 * waits for the turn to be over; background commands, PR watch loops among
 * them, carry over to the restarted process. Each restart opens a new Remote
 * Control session, so a session already on is never touched, one restarted
 * recently is given time to link, and one still off after
 * `REMOTE_CONTROL_MAX_RESTARTS` restarts in a day is given up on.
 *
 * @param maxRestarts - Restarts this pass may still make, after the tick's other restarts.
 */
export function planRemoteControlRestarts(
  sessions: WorkSession[],
  login: ClaudeLoginRecord,
  restartsBySession: Record<string, string[]>,
  nowMs: number,
  maxRestarts: number,
): { connectedSessionIds: string[]; decisions: ReloadDecision[] } {
  let restartsPlanned = 0;
  const connectedSessionIds: string[] = [];
  const decisions: ReloadDecision[] = [];
  for (const session of sessions) {
    if (session.agent !== WorkSessionAgent.Claude || !hasLiveProcess(session)) continue;
    const gap = remoteControlGapOf(session, login);
    if (gap === undefined) {
      connectedSessionIds.push(session.sessionId);
      continue;
    }
    const restartsMs = recentRestartsMs(restartsBySession, session.sessionId, nowMs);
    if (session.kind === ClaudeSessionKind.Interactive) {
      decisions.push(decide(session, ReloadAction.NotifyManual, `${gap} — terminal session, run /remote-control in it`));
    } else if (session.kind !== ClaudeSessionKind.Background || !session.shortId) {
      decisions.push(decide(session, ReloadAction.Skip, `${gap} — not a background session the watch can restart`));
    } else if (restartsMs.length >= REMOTE_CONTROL_MAX_RESTARTS) {
      decisions.push(decide(session, ReloadAction.Skip, `${gap} after ${restartsMs.length} restarts today`));
    } else if (nowMs - Math.max(-Infinity, ...restartsMs) < REMOTE_CONTROL_RESTART_COOLDOWN_MS) {
      decisions.push(decide(session, ReloadAction.Skip, `${gap} — restarted recently, waiting for it to link`));
    } else if (!isTurnOver(session)) {
      decisions.push(decide(session, ReloadAction.Defer, `${gap} — turn in flight (${session.processStatus ?? session.turnStatus ?? "unknown"})`));
    } else if (restartsPlanned >= maxRestarts) {
      decisions.push(decide(session, ReloadAction.Defer, `${gap} — restart cap reached this pass`));
    } else {
      restartsPlanned++;
      decisions.push(decide(session, ReloadAction.Respawn, gap));
    }
  }
  return { connectedSessionIds: connectedSessionIds, decisions: decisions };
}

/**
 * The restart record after this pass, pruned to the counting window. A failed
 * or refused restart counts too, so neither the restart nor the workspace trust
 * probe is repeated every tick.
 */
export function recordRemoteControlRestarts(
  restartsBySession: Record<string, string[]>,
  report: ReloadReport,
  nowMs: number,
): Record<string, string[]> {
  const nowIso = new Date(nowMs).toISOString();
  const nextRestartsBySession: Record<string, string[]> = {};
  for (const sessionId of Object.keys(restartsBySession)) {
    const recent = recentRestartsMs(restartsBySession, sessionId, nowMs).map((restartedAtMs) => new Date(restartedAtMs).toISOString());
    if (recent.length > 0) nextRestartsBySession[sessionId] = recent;
  }
  for (const sessionId of [...report.respawnedSessionIds, ...report.failedSessionIds, ...report.untrustedSessionIds]) {
    nextRestartsBySession[sessionId] = [...(nextRestartsBySession[sessionId] ?? []), nowIso];
  }
  return nextRestartsBySession;
}
