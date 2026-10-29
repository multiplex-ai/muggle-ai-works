/** Tunables for ordering the local E2E queues at {@link ./queue-priority.ts}. */

/** Longest a `gh pr view` lookup may take before the checkout is ordered as one with no pull request. */
export const PR_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * How long one process reuses a checkout's lookup. Short enough that a branch
 * whose pull request was just opened soon ranks by it.
 */
export const PR_LOOKUP_CACHE_MS = 2 * 60_000;

/** Set to `off` by the test config, so no test run reaches, or is ordered by, a real pull request. */
export const PR_LOOKUP_ENV = "MUGGLE_PR_LOOKUP";
