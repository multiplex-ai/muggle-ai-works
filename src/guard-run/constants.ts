// One agent-driven command tree should never approach the cap; the incident this
// guards against was a single orphaned test watcher re-executing its bootstrap
// into ~12,500 node processes. Legitimate trees scale with the machine — a test
// runner starts one worker per logical CPU, each with its own short-lived
// children — so the default does too, and any finite ceiling still stops a storm.

/** Smallest default active-process limit, whatever the CPU count. */
export const GUARD_RUN_MIN_DEFAULT_ACTIVE_PROCESS_LIMIT = 64;

/** Default processes allowed per logical CPU. */
export const GUARD_RUN_PROCESSES_PER_CPU = 8;

/** Windows script extensions that only run through cmd.exe, never CreateProcess. */
export const WINDOWS_SHELL_SCRIPT_EXTENSIONS: readonly string[] = [".cmd", ".bat"];

export const GUARD_RUN_USAGE =
  "usage: guard-run [--limit N] [--service] -- <command...>\n" +
  `  Runs <command> with its whole process tree kernel-capped at N processes\n` +
  `  (default ${GUARD_RUN_PROCESSES_PER_CPU} per logical CPU, at least ${GUARD_RUN_MIN_DEFAULT_ACTIVE_PROCESS_LIMIT}). Default mode also ties the tree\n` +
  "  to the launcher: killing guard-run reaps every descendant. --service keeps\n" +
  "  the cap but lets the tree outlive the launcher (for dev servers).";
