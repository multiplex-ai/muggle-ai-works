import {
  MCP_CONNECT_GRACE_MS,
  MCP_MISSING_CONFIRM_MS,
  MCP_RECOVER_MAX_RESTARTS,
  MCP_RECOVER_RESTART_WINDOW_MS,
  MUGGLE_MCP_GAP,
} from "./constants.js";
import { restartDecisionOf, restartsWithinWindow } from "./restart-plan.js";
import { hasLiveProcess, isTurnOver } from "./session-liveness.js";
import { ClaudeSessionKind, ReloadAction, WorkSessionAgent, type McpRecoverPlan, type ReloadDecision, type WorkSession } from "./types.js";

/**
 * What to do with each live Claude session so every one that loads the Muggle
 * MCP server has it running. Claude never reconnects a stdio server whose
 * process died, and a session finds its tools gone only when its next turn
 * starts, so the watch restarts it first: `claude respawn` keeps the session
 * id, starts the session's MCP servers afresh, and types nothing into the
 * conversation. A session counts as missing its server once its process has
 * outlived the connect grace, its transcript lists the server, and no server
 * has run under it across the confirm window — one tick to notice, the next to
 * act, so a `/reload-plugins` restart in progress is never mistaken for a loss.
 * It waits for the turn to be over, and a session still missing its server
 * after `MCP_RECOVER_MAX_RESTARTS` restarts in a day is left for `/mcp`.
 *
 * @param isMuggleMcpServerListed - Whether the session's transcript lists the Muggle MCP server; asked only of sessions missing one.
 * @param missingSinceBySession - When each session was first seen without its server, from the last tick.
 * @param maxRestarts - Restarts this pass may still make, after the tick's other restarts.
 */
export function planMcpRecoverRestarts(
  sessions: WorkSession[],
  isMuggleMcpServerListed: (sessionId: string) => boolean,
  missingSinceBySession: Record<string, string>,
  restartsBySession: Record<string, string[]>,
  nowMs: number,
  maxRestarts: number,
): McpRecoverPlan {
  let restartsPlanned = 0;
  const connectedSessionIds: string[] = [];
  const decisions: ReloadDecision[] = [];
  const nextMissingSinceBySession: Record<string, string> = {};
  for (const session of sessions) {
    if (session.agent !== WorkSessionAgent.Claude || !hasLiveProcess(session) || session.hasMuggleMcpServer === undefined) continue;
    if (session.hasMuggleMcpServer) {
      connectedSessionIds.push(session.sessionId);
      continue;
    }
    const isStarting = session.loadedAtMs === undefined || nowMs - session.loadedAtMs < MCP_CONNECT_GRACE_MS;
    if (isStarting || !isMuggleMcpServerListed(session.sessionId)) continue;
    const recordedMissingSinceMs = Date.parse(missingSinceBySession[session.sessionId] ?? "");
    const missingSinceMs = Number.isNaN(recordedMissingSinceMs) ? nowMs : recordedMissingSinceMs;
    nextMissingSinceBySession[session.sessionId] = new Date(missingSinceMs).toISOString();
    const restartsMs = restartsWithinWindow(restartsBySession, session.sessionId, nowMs, MCP_RECOVER_RESTART_WINDOW_MS);
    if (nowMs - missingSinceMs < MCP_MISSING_CONFIRM_MS) {
      decisions.push(restartDecisionOf(session, ReloadAction.Defer, `${MUGGLE_MCP_GAP} — confirming on the next tick`));
    } else if (session.kind === ClaudeSessionKind.Interactive) {
      decisions.push(restartDecisionOf(session, ReloadAction.NotifyManual, `${MUGGLE_MCP_GAP} — terminal session, run /mcp in it`));
    } else if (session.kind !== ClaudeSessionKind.Background || !session.shortId) {
      decisions.push(restartDecisionOf(session, ReloadAction.Skip, `${MUGGLE_MCP_GAP} — not a background session the watch can restart`));
    } else if (restartsMs.length >= MCP_RECOVER_MAX_RESTARTS) {
      decisions.push(restartDecisionOf(session, ReloadAction.Skip, `${MUGGLE_MCP_GAP} after ${restartsMs.length} restarts today — run /mcp in it`));
    } else if (!isTurnOver(session)) {
      decisions.push(restartDecisionOf(session, ReloadAction.Defer, `${MUGGLE_MCP_GAP} — turn in flight (${session.processStatus ?? session.turnStatus ?? "unknown"})`));
    } else if (restartsPlanned >= maxRestarts) {
      decisions.push(restartDecisionOf(session, ReloadAction.Defer, `${MUGGLE_MCP_GAP} — restart cap reached this pass`));
    } else {
      restartsPlanned++;
      decisions.push(restartDecisionOf(session, ReloadAction.Respawn, MUGGLE_MCP_GAP));
    }
  }
  return { connectedSessionIds: connectedSessionIds, decisions: decisions, missingSinceBySession: nextMissingSinceBySession };
}
