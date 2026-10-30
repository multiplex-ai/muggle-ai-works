import { MAX_RESPAWNS_PER_TICK } from "./constants.js";
import { hasLiveProcess } from "./session-liveness.js";
import {
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
  return {
    sessionId: session.sessionId,
    shortId: session.shortId,
    name: session.name,
    cwd: session.cwd,
    action: action,
    reason: reason,
  };
}

// A session's plugins date from when it loaded them; with no stamp, its start is the best evidence there is.
function hasCurrentPlugins(session: WorkSession, pending: PendingReload): boolean {
  const loadedAtMs = session.loadedAtMs ?? session.startedAtMs;
  return loadedAtMs !== undefined && loadedAtMs >= pending.changedAtMs;
}

/**
 * What to do with each Claude session so every live one runs the plugins installed at `pending.changedAtMs`.
 *
 * Only a restart reloads another session's plugins, so it is reserved for idle
 * background sessions — a finished job still running old code included. A
 * session that owns open PR watches is left running: a restart would cut its
 * watch loop off from it, and nothing may be pushed into its conversation to
 * bring the loop back. A busy or waiting session is retried on a later pass. A
 * terminal session cannot be reached — commands in cross-session messages
 * arrive as plain text — so its user is told once instead. A session with no
 * live process loads current plugins whenever it is next resumed, so it needs nothing.
 *
 * @param watchOwnerSessionIds - Sessions that own a PR-watch slot whose PR is open.
 */
export function planReloadFanOut(
  sessions: WorkSession[],
  pending: PendingReload,
  watchOwnerSessionIds: Set<string>,
  maxRestarts: number = MAX_RESPAWNS_PER_TICK,
): ReloadDecision[] {
  let restartsPlanned = 0;
  const decisions: ReloadDecision[] = [];
  for (const session of sessions) {
    if (session.agent !== WorkSessionAgent.Claude) continue;
    if (!hasLiveProcess(session)) {
      decisions.push(decide(session, ReloadAction.Skip, "no live process"));
    } else if (hasCurrentPlugins(session, pending)) {
      decisions.push(decide(session, ReloadAction.Skip, "already on the installed build"));
    } else if (pending.respawnedSessionIds.includes(session.sessionId) || pending.skippedSessionIds.includes(session.sessionId)) {
      decisions.push(decide(session, ReloadAction.Skip, "already handled for this install"));
    } else if (session.kind === ClaudeSessionKind.Interactive) {
      decisions.push(pending.notifiedSessionIds.includes(session.sessionId)
        ? decide(session, ReloadAction.Skip, "already asked to run /reload-plugins")
        : decide(session, ReloadAction.NotifyManual, "terminal session — run /reload-plugins in it"));
    } else if (session.kind !== ClaudeSessionKind.Background || !session.shortId) {
      decisions.push(decide(session, ReloadAction.Skip, "not a background session the watch can restart"));
    } else if (session.turnStatus !== ClaudeTurnStatus.Idle) {
      decisions.push(decide(session, ReloadAction.Defer, `turn in flight (${session.turnStatus ?? "unknown"})`));
    } else if (watchOwnerSessionIds.has(session.sessionId)) {
      decisions.push(decide(session, ReloadAction.Skip, "owns open PR watches — left running; run /reload-plugins in it"));
    } else if (restartsPlanned >= maxRestarts) {
      decisions.push(decide(session, ReloadAction.Defer, "restart cap reached this pass"));
    } else {
      restartsPlanned++;
      decisions.push(decide(session, ReloadAction.Respawn, "idle background session"));
    }
  }
  return decisions;
}

/**
 * Respawn every session the plan marked, but only where `canRestartIn` confirms
 * Claude will bring it back: a session it then refuses to resume is stranded,
 * so an unconfirmed workspace's session is left running.
 */
export function executeReloadFanOut(
  decisions: ReloadDecision[],
  runCommand: CommandRunner,
  canRestartIn: (cwd: string) => boolean,
): ReloadReport {
  const restartableByCwd = new Map<string, boolean>();
  const isRestartable = (cwd: string): boolean => {
    if (!restartableByCwd.has(cwd)) restartableByCwd.set(cwd, canRestartIn(cwd));
    return restartableByCwd.get(cwd) === true;
  };
  const report: ReloadReport = { decisions: decisions, respawnedSessionIds: [], failedSessionIds: [], untrustedSessionIds: [] };
  for (const decision of decisions) {
    if (decision.action !== ReloadAction.Respawn || !decision.shortId) continue;
    if (!decision.cwd || !isRestartable(decision.cwd)) {
      report.untrustedSessionIds.push(decision.sessionId);
      continue;
    }
    const isRestarted = runCommand("claude", ["respawn", decision.shortId])?.exitCode === 0;
    (isRestarted ? report.respawnedSessionIds : report.failedSessionIds).push(decision.sessionId);
  }
  return report;
}

/**
 * The reload record after this pass. A failed restart counts as attempted, and
 * an unrestartable session is not tried again: repeating either would only
 * repeat the failure.
 */
export function advancePendingReload(pending: PendingReload, report: ReloadReport): PendingReload {
  const notifiedSessionIds = report.decisions
    .filter((decision) => decision.action === ReloadAction.NotifyManual)
    .map((decision) => decision.sessionId);
  return {
    ...pending,
    respawnedSessionIds: [...pending.respawnedSessionIds, ...report.respawnedSessionIds, ...report.failedSessionIds],
    notifiedSessionIds: [...pending.notifiedSessionIds, ...notifiedSessionIds],
    skippedSessionIds: [...pending.skippedSessionIds, ...report.untrustedSessionIds],
  };
}
