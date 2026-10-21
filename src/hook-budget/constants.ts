/** Wall-time ceiling for one hook command, in milliseconds. Hooks fire on every tool call, prompt and turn end. */
export const HOOK_RUNTIME_BUDGET_MS = 1_000;

/** Wall-time ceiling for all the hook commands one event firing launches, summed, in milliseconds. */
export const EVENT_HOOK_RUNTIME_BUDGET_MS = 2_000;

/**
 * Milliseconds after a hook's gates start by which every child process they spawned must have exited. The rest of
 * HOOK_RUNTIME_BUDGET_MS covers the bash launcher, Node's start, and the state write after the last child.
 */
export const HOOK_CHILD_PROCESS_DEADLINE_MS = 600;
