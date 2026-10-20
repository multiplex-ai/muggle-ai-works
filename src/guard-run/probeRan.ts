import type { SpawnSyncReturns } from "node:child_process";

/**
 * Whether a synchronous probe ran to completion, judged by the exit status the
 * child returned.
 *
 * Inside Codex's Linux sandbox every spawn with piped stdio comes back with an
 * EPERM error — its seccomp filter denies the socket options the pipe setup asks
 * for — although the child runs to completion and its output is captured, so
 * that error alone is never the verdict. A probe that could not start at all
 * (the program is missing) has no exit status.
 */
export function probeRan(probe: Pick<SpawnSyncReturns<string>, "status" | "stdout">): boolean {
  return probe.status !== null && typeof probe.stdout === "string";
}
