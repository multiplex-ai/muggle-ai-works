/** Overrides which studio binary the harness spawns; a machine-specific path never belongs in the tree. */
export const STUDIO_BIN_ENV_VAR = "MUGGLE_STUDIO_BIN";

/** Resolved on `PATH` when `MUGGLE_STUDIO_BIN` is unset — set the env var to a build output instead. */
export const DEFAULT_STUDIO_BIN = "muggle-studio";

/** Names the studio flag that points at the task file. */
export const BENCHMARK_TASK_FLAG = "--benchmark-task";

/** The harness writes the task file here, inside the task's own trajectory directory. */
export const STUDIO_TASK_FILENAME = "task.json";

/** Studio writes its result here, beside the task file. */
export const STUDIO_RESULT_FILENAME = "result.json";

/** The `studioStatus` studio reports when it believes it finished; any other value is a self-reported failure. */
export const STUDIO_STATUS_SUCCESS = "success";

/** How much studio stderr to keep for an error message — enough for a stack, short of a log dump. */
export const STDERR_TAIL_LIMIT = 4_000;

/**
 * Studio's run mode, passed positionally as the first argument. Studio reads
 * `argv[1]` as the mode before scanning for flags, so omitting it makes the
 * benchmark flag itself land in the mode slot and the process exits with
 * "Unsupported run mode --benchmark-task". Benchmark mode is explore plus the
 * task-file marker, never a mode of its own.
 */
export const STUDIO_RUN_MODE = "explore";

/** Filename for the profile studio reads as its positional auth argument. */
export const STUDIO_AUTH_FILENAME = "studio-auth.json";

/**
 * The muggle session `muggle login` writes, and the source of the identity the
 * benchmark hands studio.
 */
export const MUGGLE_SESSION_PATH_SEGMENTS = [".muggle-ai", "oauth-session.json"];
