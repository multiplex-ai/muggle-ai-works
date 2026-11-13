import type { ReloadAction, ReloadDecision, ReloadReport, WorkSession } from "./types.js";

/** A pass's decision for one session, carrying what the restart and the status rows need. */
export function restartDecisionOf(session: WorkSession, action: ReloadAction, reason: string): ReloadDecision {
  return {
    sessionId: session.sessionId,
    shortId: session.shortId,
    name: session.name,
    cwd: session.cwd,
    action: action,
    reason: reason,
  };
}

/** When a pass restarted the session inside `windowMs` before `nowMs`, as epoch ms; unreadable entries are dropped. */
export function restartsWithinWindow(
  restartsBySession: Record<string, string[]>,
  sessionId: string,
  nowMs: number,
  windowMs: number,
): number[] {
  return (restartsBySession[sessionId] ?? [])
    .map((restartedAt) => Date.parse(restartedAt))
    .filter((restartedAtMs) => !Number.isNaN(restartedAtMs) && nowMs - restartedAtMs < windowMs);
}

/**
 * A pass's restart record after it ran, pruned to `windowMs`. A failed or
 * refused restart counts too, so neither the restart nor the workspace trust
 * probe is repeated every tick.
 *
 * Output shape: `{ "6f573971-…": ["2026-11-13T07:30:00.000Z"] }`
 */
export function recordRestartAttempts(
  restartsBySession: Record<string, string[]>,
  report: ReloadReport,
  nowMs: number,
  windowMs: number,
): Record<string, string[]> {
  const nowIso = new Date(nowMs).toISOString();
  const nextRestartsBySession: Record<string, string[]> = {};
  for (const sessionId of Object.keys(restartsBySession)) {
    const recent = restartsWithinWindow(restartsBySession, sessionId, nowMs, windowMs).map((restartedAtMs) => new Date(restartedAtMs).toISOString());
    if (recent.length > 0) nextRestartsBySession[sessionId] = recent;
  }
  for (const sessionId of [...report.respawnedSessionIds, ...report.failedSessionIds, ...report.untrustedSessionIds]) {
    nextRestartsBySession[sessionId] = [...(nextRestartsBySession[sessionId] ?? []), nowIso];
  }
  return nextRestartsBySession;
}
