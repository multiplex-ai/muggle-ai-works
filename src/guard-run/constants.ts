// One agent-driven command tree should never approach this; the incident this
// guards against was a single orphaned test watcher re-executing its bootstrap
// into ~12,500 node processes.
export const GUARD_RUN_DEFAULT_ACTIVE_PROCESS_LIMIT = 64;

export const GUARD_RUN_USAGE =
  "usage: guard-run [--limit N] [--service] -- <command...>\n" +
  "  Runs <command> with its whole process tree kernel-capped at N processes\n" +
  "  (default 64). Default mode also ties the tree to the launcher: killing\n" +
  "  guard-run reaps every descendant. --service keeps the cap but lets the\n" +
  "  tree outlive the launcher (for dev servers).";
