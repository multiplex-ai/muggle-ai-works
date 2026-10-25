import { MAX_RESPAWNS_PER_TICK } from "./constants.js";
import {
  ClaudeJobState,
  ClaudeSessionKind,
  ClaudeTurnStatus,
  ReloadAction,
  WorkSessionAgent,
  type CommandRunner,
  type PendingReload,
  type ReloadDecision,
  type ReloadReport,
  type WorkSession,
} from "./types.js";

function decide(session: WorkSession, action: ReloadAction, reason: string): ReloadDecision {
  return { sessionId: session.sessionId, shortId: session.shortId, name: session.name, action: action, reason: reason };
}

/**
 * What to do with each Claude session for a pending plugin change.
 *
 * Only `claude respawn` reloads another session's plugins, and it restarts the
 * process, so it is reserved for background sessions with no turn in flight; a
 * busy or waiting one is retried on a later tick. A terminal session cannot be
 * reached at all — commands in cross-session messages arrive as plain text — so
 * its user is told once instead.
 */
export function planReloadFanOut(
  sessions: WorkSession[],
  pending: PendingReload,
  maxRespawns: number = MAX_RESPAWNS_PER_TICK,
): ReloadDecision[] {
  let respawnsPlanned = 0;
  const decisions: ReloadDecision[] = [];
  for (const session of sessions) {
    if (session.agent !== WorkSessionAgent.Claude) continue;
    if (session.startedAtMs !== undefined && session.startedAtMs >= pending.changedAtMs) {
      decisions.push(decide(session, ReloadAction.Skip, "started after the plugin change"));
    } else if (pending.respawnedSessionIds.includes(session.sessionId)) {
      decisions.push(decide(session, ReloadAction.Skip, "already respawned"));
    } else if (session.kind === ClaudeSessionKind.Interactive) {
      decisions.push(pending.notifiedSessionIds.includes(session.sessionId)
        ? decide(session, ReloadAction.Skip, "already asked to run /reload-plugins")
        : decide(session, ReloadAction.NotifyManual, "terminal session — run /reload-plugins in it"));
    } else if (session.kind !== ClaudeSessionKind.Background || !session.shortId) {
      decisions.push(decide(session, ReloadAction.Skip, "not a background session the watch can respawn"));
    } else if (session.jobState === ClaudeJobState.Done) {
      decisions.push(decide(session, ReloadAction.Skip, "job finished"));
    } else if (session.turnStatus !== ClaudeTurnStatus.Idle) {
      decisions.push(decide(session, ReloadAction.Defer, `turn in flight (${session.turnStatus ?? "unknown"})`));
    } else if (respawnsPlanned >= maxRespawns) {
      decisions.push(decide(session, ReloadAction.Defer, "respawn cap reached this tick"));
    } else {
      respawnsPlanned++;
      decisions.push(decide(session, ReloadAction.Respawn, "idle background session"));
    }
  }
  return decisions;
}

/** Respawn every session the plan marked for it. */
export function executeReloadFanOut(decisions: ReloadDecision[], runCommand: CommandRunner): ReloadReport {
  const respawnedSessionIds: string[] = [];
  const failedSessionIds: string[] = [];
  for (const decision of decisions) {
    if (decision.action !== ReloadAction.Respawn || !decision.shortId) continue;
    const outcome = runCommand("claude", ["respawn", decision.shortId]);
    (outcome?.exitCode === 0 ? respawnedSessionIds : failedSessionIds).push(decision.sessionId);
  }
  return { decisions: decisions, respawnedSessionIds: respawnedSessionIds, failedSessionIds: failedSessionIds };
}

/**
 * The pending change after this pass, or undefined once nothing is left to
 * retry. A failed respawn counts as attempted: retrying a session that refuses
 * every tick would only repeat the failure.
 */
export function advancePendingReload(pending: PendingReload, report: ReloadReport): PendingReload | undefined {
  if (!report.decisions.some((decision) => decision.action === ReloadAction.Defer)) return undefined;
  const notifiedSessionIds = report.decisions
    .filter((decision) => decision.action === ReloadAction.NotifyManual)
    .map((decision) => decision.sessionId);
  return {
    ...pending,
    respawnedSessionIds: [...pending.respawnedSessionIds, ...report.respawnedSessionIds, ...report.failedSessionIds],
    notifiedSessionIds: [...pending.notifiedSessionIds, ...notifiedSessionIds],
  };
}
