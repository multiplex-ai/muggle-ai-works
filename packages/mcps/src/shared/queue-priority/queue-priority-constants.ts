/** Tunables for ordering the local E2E queues at {@link ./queue-priority.ts}. */

import { StudioJobPriorityEnum } from "./queue-priority-types.js";

/** Order classes are served in, lowest first. */
export const STUDIO_JOB_PRIORITY_RANK: Record<StudioJobPriorityEnum, number> = {
  [StudioJobPriorityEnum.Paid]: 0,
  [StudioJobPriorityEnum.Free]: 1,
  [StudioJobPriorityEnum.Internal]: 2,
  [StudioJobPriorityEnum.Promotion]: 3,
};

/** Class of a local run that names none: the operator's own acceptance work. */
export const DEFAULT_LOCAL_STUDIO_JOB_PRIORITY = StudioJobPriorityEnum.Internal;

/**
 * What a local execute tool's `priority` input means, shown to the calling agent. Terse because
 * the generation tool's whole schema must fit Codex's 5000-byte tool limit.
 */
export const STUDIO_JOB_PRIORITY_INPUT_DESCRIPTION = "Queue class; default internal.";

/** Longest a `gh pr view` lookup may take before the checkout is ordered as one with no pull request. */
export const PR_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * How long one process reuses a checkout's lookup. Short enough that a branch
 * whose pull request was just opened soon ranks by it.
 */
export const PR_LOOKUP_CACHE_MS = 2 * 60_000;

/** Set to `off` by the test config, so no test run reaches, or is ordered by, a real pull request. */
export const PR_LOOKUP_ENV = "MUGGLE_PR_LOOKUP";
