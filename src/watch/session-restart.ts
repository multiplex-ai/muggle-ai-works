import { RECOVERY_RESUME_PROMPT } from "./constants.js";
import type { CommandRunner, ReconcileResumeTarget } from "./types.js";

/**
 * Resume a session in the background on reconcile, continuing it under its own
 * id and name. A running session is stopped first and its exit awaited, and
 * the resume passes no flag beyond `--bg`: resuming a session that is still
 * running, or with options of its own, starts a copy under a new id that the
 * agent view lists beside the original, named after the prompt.
 *
 * @param waitForExit - Whether the session's process exited after the stop.
 * @returns Whether the resume started.
 */
export function resumeOnReconcile(
  target: ReconcileResumeTarget,
  runCommand: CommandRunner,
  waitForExit: (sessionId: string) => boolean,
): boolean {
  if (target.runningShortId !== undefined) {
    runCommand("claude", ["stop", target.runningShortId]);
    if (!waitForExit(target.runningSessionId ?? target.sessionId)) return false;
  }
  const resumed = runCommand("claude", ["--resume", target.sessionId, "--bg", RECOVERY_RESUME_PROMPT], { cwd: target.cwd });
  return resumed?.exitCode === 0;
}
