import { fileURLToPath } from "url";

/** Module specifiers that resolve to Node's child_process. */
export const CHILD_PROCESS_MODULES = ["child_process", "node:child_process"];

/** child_process functions that start a process and accept a `windowsHide` option. */
export const SPAWNING_FUNCTIONS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"];

/** Repository root, for reporting scanned files by relative path. */
export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** The shipped hook runtime: every script the plugin's hooks run, bundles and hand-written launchers alike. */
export const PLUGIN_SCRIPTS_DIR = fileURLToPath(new URL("../../../../plugin/scripts", import.meta.url));

/** The tsup entries bundled into plugin/scripts — the sources whose import graph the bundles are built from. */
export const HOOK_RUNTIME_SOURCE_ENTRIES = [
  fileURLToPath(new URL("../../../guardrails/cli.ts", import.meta.url)),
  fileURLToPath(new URL("../../../guard-run/cli.ts", import.meta.url)),
];
