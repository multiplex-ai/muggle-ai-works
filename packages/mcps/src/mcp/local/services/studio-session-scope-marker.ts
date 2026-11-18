import { getLogger } from "../../../shared/logger.js";
import type { ILocalExecutionLockHandle } from "./local-execution-lock-types.js";
import { STUDIO_SESSION_SCOPE_STDOUT_PREFIX } from "./studio-session-scope-constants.js";
import { StudioSessionScopeStateEnum, type StudioSessionScopeStateListener } from "./studio-session-scope-types.js";

const knownSessionScopeStates = new Set<string>(Object.values(StudioSessionScopeStateEnum));

/**
 * Read the session state from one Studio stdout line.
 *
 * @returns The state, or null when the line is not a well-formed session-scope line.
 */
export function parseStudioSessionScopeLine(stdoutLine: string): StudioSessionScopeStateEnum | null {
  const trimmedLine = stdoutLine.trim();
  if (!trimmedLine.startsWith(STUDIO_SESSION_SCOPE_STDOUT_PREFIX)) return null;
  try {
    const markerPayload = JSON.parse(trimmedLine.slice(STUDIO_SESSION_SCOPE_STDOUT_PREFIX.length)) as { state?: unknown };
    return typeof markerPayload.state === "string" && knownSessionScopeStates.has(markerPayload.state)
      ? (markerPayload.state as StudioSessionScopeStateEnum)
      : null;
  } catch {
    return null;
  }
}

/**
 * Build a stdout chunk consumer that tells the listener each session state Studio prints. A line split
 * across chunks is read once whole.
 */
export function createStudioSessionScopeStdoutReader(listener: StudioSessionScopeStateListener): (stdoutChunk: string) => void {
  let unterminatedLine = "";
  return (stdoutChunk: string) => {
    const lines = (unterminatedLine + stdoutChunk).split("\n");
    unterminatedLine = lines.pop() ?? "";
    for (const stdoutLine of lines) {
      const sessionScopeState = parseStudioSessionScopeLine(stdoutLine);
      if (sessionScopeState !== null) listener(sessionScopeState);
    }
  };
}

/**
 * Stop counting a run against the local-execution lock while its Studio waits for its session, and count it
 * again once Studio holds it.
 */
export function createSessionWaitLockListener(lockHandle: ILocalExecutionLockHandle): StudioSessionScopeStateListener {
  return (sessionScopeState: StudioSessionScopeStateEnum) => {
    const lockTransition =
      sessionScopeState === StudioSessionScopeStateEnum.Waiting
        ? lockHandle.yieldForSessionWait()
        : lockHandle.reclaimAfterSessionWait();
    lockTransition.catch((error: unknown) => {
      getLogger().warn("Local-execution lock did not follow the Studio session state", {
        sessionScopeState: sessionScopeState,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
}
