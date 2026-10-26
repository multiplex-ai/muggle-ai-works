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
