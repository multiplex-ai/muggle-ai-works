/** WebVoyager caps agents at 15 actions per task; matching it keeps scores comparable. */
export const MAX_STEPS_PER_TASK = 15;

/** Wall-clock budget per task before the attempt is recorded as an infrastructure error. */
export const TASK_TIMEOUT_MS = 600_000;

/** Parallel studio processes. Each is a full Electron instance — memory-bound, not CPU-bound. */
export const DEFAULT_CONCURRENCY = 2;
