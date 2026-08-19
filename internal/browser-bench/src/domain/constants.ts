/** WebVoyager caps agents at 15 actions per task; matching it keeps scores comparable. */
export const MAX_STEPS_PER_TASK = 15;

/** Wall-clock budget per task before the attempt is recorded as an infrastructure error. */
export const TASK_TIMEOUT_MS = 600_000;

/** Parallel studio processes. Each is a full Electron instance — memory-bound, not CPU-bound. */
export const DEFAULT_CONCURRENCY = 2;

/** Per-task studio artifacts land in `<out>/trajectories/<taskId>/`. */
export const TRAJECTORIES_DIRNAME = "trajectories";

/** Every task gets its own `<out>/profiles/<taskId>/`, so no logged-in state leaks between tasks. */
export const BROWSER_PROFILES_DIRNAME = "profiles";

/** Results are appended to `<out>/partial.jsonl` as they land, so an interrupted batch can resume. */
export const PARTIAL_LOG_FILENAME = "partial.jsonl";

/** The rendered batch report at `<out>/report.md`. */
export const REPORT_FILENAME = "report.md";
