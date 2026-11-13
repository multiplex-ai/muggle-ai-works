import type { IStackClaimReport } from "@muggleai/mcp";

/** Flags of `muggle stack claim`. */
export interface StackClaimFlags {
  /** Directory inside the claiming checkout; the current directory when omitted. */
  cwd?: string;
  /** `<port>=<run-dir>` or `<port>=<run-dir>@<sha>`, once per port. */
  need: string[];
  /** Name shown to peers waiting on this checkout. */
  label?: string;
  /** Seconds to keep re-asking while busy; answers after one attempt when omitted. */
  wait?: string;
  /** Print the full report as JSON instead of a summary. */
  json?: boolean;
}

/** What `muggle stack claim --json` prints: the claim's report and, when busy, the command that waits for the turn. */
export interface IStackClaimOutput extends IStackClaimReport {
  /** The same claim with `--wait`, to run as a background command: it exits once the stack is granted, which wakes the session. */
  waitCommand?: string;
}

/** Flags of `muggle stack check`. */
export interface StackCheckFlags {
  cwd?: string;
  /** Port the run will target. */
  port?: string;
  json?: boolean;
}

/** Flags of `muggle stack release`. */
export interface StackReleaseFlags {
  cwd?: string;
  json?: boolean;
}

/** Flags of `muggle stack status`. */
export interface StackStatusFlags {
  json?: boolean;
}
