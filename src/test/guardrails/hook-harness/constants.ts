import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";

/** The guardrails CLI source entry every hook command reaches, run from source so a test exercises the code under review rather than the committed bundle. */
export const GUARDRAIL_CLI_ENTRY = fileURLToPath(new URL("../../../guardrails/cli.ts", import.meta.url));

/**
 * The tsx loader as a file URL. A bare `tsx` specifier resolves against the working directory, and the CLI's
 * detached background jobs inherit the hook's loader flag while running in the payload's `cwd` — a fixture repo
 * with no node_modules — so only an absolute URL lets them start there.
 */
export const TSX_LOADER_URL = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

/** Where per-session guardrail state lives under HOME. */
export const GUARDRAIL_STATE_PATH_SEGMENTS = [".muggle-ai", "guardrails"] as const;

/** Where muggle-do session slots live under HOME. */
export const MUGGLE_DO_SESSIONS_PATH_SEGMENTS = [".muggle-ai", "muggle-do", "sessions"] as const;

/** A hook's answer when it has nothing to say. */
export const SILENT_HOOK_OUTPUT = "{}";

/** A gate wrapper script named inside a hooks.json command. */
export const GUARDRAIL_WRAPPER_SCRIPT = /guardrail-[a-z0-9-]+\.sh/g;

/** The wrapper that fans one event out to the gate wrappers listed after it; it feeds no subcommand of its own. */
export const GUARDRAIL_DISPATCH_WRAPPER = "guardrail-dispatch.sh";

/** The asyncRewake companion, which hands an event's gates on like the dispatcher rather than being one. */
export const GUARDRAIL_REWAKE_WRAPPER = "guardrail-rewake.sh";

/** The line in a gate wrapper naming the CLI subcommand it feeds. */
export const GUARDRAIL_SUBCOMMAND_ASSIGNMENT = /^GUARDRAIL_SUBCOMMAND="([^"]+)"/m;

/** Env var the walkthrough-probe `gh` stub prints for the working branch's PR lookup. */
export const WALKTHROUGH_PROBE_BRANCH_PR_URL_ENV = "STUB_PR_URL";

/** Env var the walkthrough-probe `gh` stub prints for `gh pr view <url> --json body,comments`. */
export const WALKTHROUGH_PROBE_PR_CONTENT_ENV = "STUB_PR_CONTENT";

/**
 * Bash body of a `gh` stand-in for the walkthrough gate's two provider reads: `--json body,comments` is the
 * walkthrough probe and prints the PR's content; anything else is the branch-PR lookup and prints its url.
 */
export const WALKTHROUGH_PROBE_GH_STUB_BODY =
  `for a in "$@"; do\n` +
  `  if [ "$a" = "body,comments" ]; then printf '%s' "$${WALKTHROUGH_PROBE_PR_CONTENT_ENV}"; exit 0; fi\n` +
  `done\n` +
  `printf '%s' "$${WALKTHROUGH_PROBE_BRANCH_PR_URL_ENV}"\n`;

/** The only files Windows runs for a bare `gh`, which is why no script can stand in for it there. */
export const WINDOWS_GH_EXECUTABLES = ["gh.exe", "gh.com"] as const;
