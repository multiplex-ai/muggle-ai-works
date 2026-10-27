import { fileURLToPath } from "url";

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

/** The tsup entries bundled into plugin/scripts — the sources whose import graph the bundles are built from. */
export const HOOK_RUNTIME_SOURCE_ENTRIES = [
  fileURLToPath(new URL("../../../guardrails/cli.ts", import.meta.url)),
  fileURLToPath(new URL("../../../guard-run/cli.ts", import.meta.url)),
  fileURLToPath(new URL("../../../pr-watch/cli.ts", import.meta.url)),
];

/** The repository every watch slot fixture's PR lives in: one that does not exist, so nothing can reach it. */
export const WATCH_FIXTURE_REPO = "footprint-fixture/no-such-repo";
