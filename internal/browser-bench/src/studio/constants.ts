/** Overrides which studio binary the harness spawns; a machine-specific path never belongs in the tree. */
export const STUDIO_BIN_ENV_VAR = "MUGGLE_STUDIO_BIN";

/** Resolved on `PATH` when `MUGGLE_STUDIO_BIN` is unset — set the env var to a build output instead. */
export const DEFAULT_STUDIO_BIN = "muggle-studio";

/**
 * Carries the per-task browser profile to studio. The spawn contract's two
 * flags are fixed and neither names a profile, so the environment is the only
 * seam left for it.
 */
export const BROWSER_PROFILE_DIR_ENV_VAR = "MUGGLE_STUDIO_BROWSER_PROFILE_DIR";

/** Names the studio flag that points at the task file. */
export const BENCHMARK_TASK_FLAG = "--benchmark-task";

/** Names the studio flag that points at the result file studio must write. */
export const BENCHMARK_OUT_FLAG = "--out";

/** The harness writes the task file here, inside the task's own trajectory directory. */
export const STUDIO_TASK_FILENAME = "task.json";

/** Studio writes its result here, beside the task file. */
export const STUDIO_RESULT_FILENAME = "result.json";

/** The `studioStatus` studio reports when it believes it finished; any other value is a self-reported failure. */
export const STUDIO_STATUS_SUCCESS = "success";

/** How much studio stderr to keep for an error message — enough for a stack, short of a log dump. */
export const STDERR_TAIL_LIMIT = 4_000;
