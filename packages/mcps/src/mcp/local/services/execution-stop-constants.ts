/**
 * How long a stopped run gets to end on its own — finish its step, publish what it recorded, quit — before the
 * Electron process is hard-killed. Covers the studio's publish retry budget plus the uploads themselves.
 */
export const STOP_REQUEST_GRACE_MS = 90_000;

/**
 * Suffix of the file that asks the studio to stop: `<tempDir>/<runId>_stop_requested`. The studio watches this
 * exact name, next to the `<runId>_input.json` and `<runId>_runtime_dir.txt` it already shares with the MCP.
 */
export const STOP_REQUEST_FILE_SUFFIX = "_stop_requested";
