import {
  BACKGROUNDED_SESSION_ID_PATTERN,
  TRUST_PROBE_PROMPT,
  TRUST_PROBE_SESSION_NAME,
  WORKSPACE_UNTRUSTED_PATTERN,
} from "./constants.js";
import type { CommandRunner } from "./types.js";

/**
 * Whether Claude will restart a background session in `cwd`.
 *
 * Claude's per-folder trust flags do not predict this, so the check is
 * empirical: a throwaway background launch either is refused before anything
 * starts, or starts and is stopped and removed at once. Anything short of a
 * confirmed start reads as not resumable, so a session is never stopped on a guess.
 */
export function canRestartSessionIn(cwd: string, runCommand: CommandRunner): boolean {
  const probe = runCommand("claude", ["--bg", "--name", TRUST_PROBE_SESSION_NAME, TRUST_PROBE_PROMPT], { cwd: cwd });
  const probeId = probe?.stdout.match(BACKGROUNDED_SESSION_ID_PATTERN)?.[1];
  if (probeId) {
    runCommand("claude", ["stop", probeId]);
    runCommand("claude", ["rm", probeId]);
  }
  return probe?.exitCode === 0 && probeId !== undefined && !WORKSPACE_UNTRUSTED_PATTERN.test(probe.stdout);
}
