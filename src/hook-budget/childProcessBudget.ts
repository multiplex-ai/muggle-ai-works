import { HOOK_CHILD_PROCESS_DEADLINE_MS } from "./constants.js";

let childProcessDeadlineEpochMs: number | null = null;

/**
 * Caps every later {@link boundedChildTimeoutMs} at the hook's child-process allowance, counted from `gatesStartEpochMs`.
 * Only hook entrypoints call it, so the CLI sharing the same runners keeps their full timeouts.
 * @param gatesStartEpochMs - When the hook's gates began; defaults to now.
 */
export function enforceHookChildProcessDeadline(gatesStartEpochMs: number = Date.now()): void {
  childProcessDeadlineEpochMs = gatesStartEpochMs + HOOK_CHILD_PROCESS_DEADLINE_MS;
}

/**
 * The timeout to give a child process: `ceilingMs`, cut to what remains of the hook budget once one is enforced.
 * @returns null when the budget is spent, so the caller skips the spawn and degrades as it does on a failed one.
 */
export function boundedChildTimeoutMs(ceilingMs: number): number | null {
  if (childProcessDeadlineEpochMs === null) return ceilingMs;
  const remainingMs = Math.floor(childProcessDeadlineEpochMs - Date.now());
  return remainingMs > 0 ? Math.min(ceilingMs, remainingMs) : null;
}
