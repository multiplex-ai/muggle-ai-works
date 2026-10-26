import { ClaudeSessionKind, ClaudeTurnStatus, WorkSessionAgent, type WorkSession } from "./types.js";

/**
 * Whether a process is running behind the session. `claude agents` keeps
 * listing a background session after its process exits, with neither a pid
 * nor a turn status; Codex sessions are listed only while they are active.
 */
export function hasLiveProcess(session: WorkSession): boolean {
  if (session.agent !== WorkSessionAgent.Claude) return true;
  return session.pid !== undefined || session.turnStatus !== undefined;
}

/** Whether the watch may stop and resume the session without cutting into a turn: a running background Claude session between turns. */
export function isIdleBackgroundSession(session: WorkSession): boolean {
  return (
    session.agent === WorkSessionAgent.Claude &&
    hasLiveProcess(session) &&
    session.kind === ClaudeSessionKind.Background &&
    session.shortId !== undefined &&
    session.turnStatus === ClaudeTurnStatus.Idle
  );
}
