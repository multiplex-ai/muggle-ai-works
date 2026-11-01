import { BACKGROUNDED_SESSION_ID_PATTERN } from "./constants.js";
import { shortSessionId } from "./format.js";
import {
  SessionResumeOutcome,
  type CommandRunner,
  type SessionResumeResult,
  type SessionResumeTarget,
} from "./types.js";

/**
 * Resume a session in the background on its target's one prompt, continuing it
 * under its own id and name. A running session is stopped first and its exit
 * awaited, and the resume passes no flag beyond `--bg`: resuming a session that
 * is still running, or with options of its own, starts a copy under a new id
 * that the agent view lists beside the original, named after the prompt.
 * Claude exits 0 either way and names the session it backgrounded, so a copy
 * is told apart by that id, then stopped and removed.
 *
 * @param waitForExit - Whether the session's process exited after the stop.
 * @param isSessionRunning - Whether Claude still runs a process for the session.
 * @returns What became of the resume.
 * Output shape: `{ outcome: "copied", copyShortId: "9abf32dd", isCopyRemoved: true }`
 */
export function resumeSession(
  target: SessionResumeTarget,
  runCommand: CommandRunner,
  waitForExit: (sessionId: string) => boolean,
  isSessionRunning: (sessionId: string) => boolean,
): SessionResumeResult {
  const runningSessionId = target.runningSessionId ?? target.sessionId;
  if (target.runningShortId !== undefined) {
    runCommand("claude", ["stop", target.runningShortId]);
    if (!waitForExit(runningSessionId)) return { outcome: SessionResumeOutcome.StillRunning };
  } else if (isSessionRunning(runningSessionId)) {
    return { outcome: SessionResumeOutcome.StillRunning };
  }
  const resumed = runCommand("claude", ["--resume", target.sessionId, "--bg", target.prompt], { cwd: target.cwd, isStderrCaptured: true });
  if (resumed?.exitCode !== 0) return { outcome: SessionResumeOutcome.Failed };
  const backgroundedShortId = resumed.stdout.match(BACKGROUNDED_SESSION_ID_PATTERN)?.[1];
  const ownShortIds = [shortSessionId(target.sessionId), shortSessionId(runningSessionId), target.runningShortId];
  // An unrecognized reply is taken as continued: removing a session on a guess could remove the owner.
  if (backgroundedShortId === undefined || ownShortIds.includes(backgroundedShortId)) return { outcome: SessionResumeOutcome.Continued };
  const isCopyStopped = runCommand("claude", ["stop", backgroundedShortId])?.exitCode === 0;
  const isCopyRemoved = isCopyStopped && runCommand("claude", ["rm", backgroundedShortId])?.exitCode === 0;
  return { outcome: SessionResumeOutcome.Copied, copyShortId: backgroundedShortId, isCopyRemoved: isCopyRemoved };
}
