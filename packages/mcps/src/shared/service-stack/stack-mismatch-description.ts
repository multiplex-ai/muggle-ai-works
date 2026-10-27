/** One-line wording of a stack mismatch, shared by the CLI and the execute tools' refusal text. */

import { LISTENER_COMMAND_MAX_CHARS } from "./service-stack-constants.js";
import { StackMismatchKind, type IStackMismatch } from "./service-stack-types.js";

/**
 * Describe what a mismatched port claimed and what it serves now.
 *
 * @param mismatch - One mismatched port from a stack check.
 * @returns A line naming the port, the claimed code, and what actually holds the port.
 *
 * Output shape: `port 3999: claimed c:\wt\a @ 286b67c, now held by untracked PID 34016 (node static_spa_server.cjs …)`
 */
export function describeStackMismatch(mismatch: IStackMismatch): string {
  const claimed = `port ${mismatch.need.port}: claimed ${mismatch.need.runDir} @ ${mismatch.need.headSha.slice(0, 7)}`;
  return `${claimed}, now ${describeCurrentHolder(mismatch)}`;
}

function describeCurrentHolder(mismatch: IStackMismatch): string {
  switch (mismatch.kind) {
    case StackMismatchKind.OtherCode: {
      const tracked = mismatch.actual;
      return tracked === null
        ? "serving other code"
        : `serving ${tracked.dir} @ ${(tracked.headSha ?? "unknown").slice(0, 7)} (PID ${tracked.pid})`;
    }
    case StackMismatchKind.NothingListening:
      return mismatch.actual === null
        ? "nothing listening"
        : `nothing listening, though tracked PID ${mismatch.actual.pid} is alive`;
    case StackMismatchKind.UntrackedListener: {
      const listener = mismatch.listener;
      if (listener === null) return "held by an untracked process";
      const command = listener.commandLine.trim();
      const shortCommand =
        command.length > LISTENER_COMMAND_MAX_CHARS ? `${command.slice(0, LISTENER_COMMAND_MAX_CHARS)}…` : command;
      return `held by untracked PID ${listener.pid}${shortCommand ? ` (${shortCommand})` : ""}`;
    }
  }
}
