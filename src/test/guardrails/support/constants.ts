import { fileURLToPath } from "url";
import type { AllowedUnhiddenSpawn } from "./types.js";

/** Module specifiers that resolve to Node's child_process. */
export const CHILD_PROCESS_MODULES = ["child_process", "node:child_process"];

/** child_process functions that start a process and accept a `windowsHide` option. */
export const SPAWNING_FUNCTIONS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];

/** Repository root, for reporting scanned files by relative path. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The shipped hook runtime: every script the plugin's hooks run, bundles and hand-written launchers alike. */
export const PLUGIN_SCRIPTS_DIR = fileURLToPath(new URL("../../../../plugin/scripts", import.meta.url));

/** The recorder wrappers the shell PostToolUse dispatcher feeds, every one of which a shell result must reach. */
export const SHELL_RECORDER_SCRIPTS = [
  "guardrail-pr-opened.sh",
  "guardrail-record-tests.sh",
  "guardrail-pr-terminal.sh",
  "guardrail-record-stage-signals.sh",
  "guardrail-record-comment-replies.sh",
  "guardrail-record-stage-read.sh",
];

/** A wrapper's whole-payload pre-filter call: `guardrail_payload_matches '<pattern>'`. */
export const PAYLOAD_PREFILTER_CALL = /guardrail_payload_matches '([^']+)'/g;

/** A wrapper's field-scoped pre-filter call: `guardrail_fields_match <field>... '<pattern>'`. */
export const FIELDS_PREFILTER_CALL = /guardrail_fields_match((?:\s+[a-z_]+)+)\s+'([^']+)'/g;

/** The POSIX class the wrappers spell whitespace with, which JavaScript spells `\s`. */
export const POSIX_SPACE_CLASS = "[[:space:]]";

/** Workspace roots whose sources tsup bundles into `dist`, which the package ships though their paths are not in `files`. */
export const BUNDLED_SOURCE_ROOTS = [
  fileURLToPath(new URL("../../../../src", import.meta.url)),
  fileURLToPath(new URL("../../../../packages", import.meta.url)),
];

/** Build output, already covered by scanning the sources it is built from. */
export const BUILD_OUTPUT_ENTRY = "dist";

/** Extensions of files Node can run. */
export const RUNNABLE_SOURCE_EXTENSIONS = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];

/** Directory names under a shipped root whose files never reach a user: tests, fixtures, installed dependencies. */
export const UNSHIPPED_DIRECTORY_NAMES = ["test", "__tests__", "fixtures", "node_modules", "dist"];

/** File-name infix of a colocated test. */
export const COLOCATED_TEST_PATTERN = /\.(test|spec)\.[cm]?[jt]s$/;

/**
 * Shipped child_process calls allowed without `windowsHide: true`, each with the reason a console window cannot
 * appear. `windowsHide` also starts a GUI program's first window hidden, so a launcher of one belongs here.
 */
export const ALLOWED_UNHIDDEN_SPAWNS: AllowedUnhiddenSpawn[] = [
  {
    file: "packages/mcps/src/mcp/local/services/execution-service.ts",
    callee: "spawn",
    reason: "Launches the Electron runner, a GUI program that opens no console; windowsHide would hide its browser window",
  },
];

/** Preload that records every child process started without `windowsHide`, dependencies' included. */
export const SPAWN_RECORDER_PRELOAD = new URL("./spawnRecorder.mjs", import.meta.url).href;

/** Entry that boots the real MCP server, as `muggle serve` does. */
export const MCP_SERVER_BOOT_ENTRY = fileURLToPath(new URL("./bootMcpServer.ts", import.meta.url));

/** How long the booted server keeps running after startup returns, for startup work it does not await. */
export const MCP_SERVER_STARTUP_SETTLE_MS = 2_000;

/** Upper bound on one boot, past which the test fails rather than waits. */
export const MCP_SERVER_BOOT_TIMEOUT_MS = 60_000;

/** A well-formed telemetry connection string whose ingestion endpoint refuses connections, so nothing leaves the machine. */
export const UNREACHABLE_TELEMETRY_CONNECTION_STRING =
  "InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=http://127.0.0.1:9/";

/** The Azure Monitor distro's default resource detectors, `host` among them. */
export const DEFAULT_RESOURCE_DETECTORS = "env,host,os";

/** The repository every watch slot fixture's PR lives in: one that does not exist, so nothing can reach it. */
export const WATCH_FIXTURE_REPO = "footprint-fixture/no-such-repo";
