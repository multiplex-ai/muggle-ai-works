import { type ErrorClassPattern } from "./types";

/** The candidate's median per-step wall time may be at most this multiple of the baseline's. */
export const MAX_STEP_TIME_RATIO = 1.2;

/** The candidate's pass rate may sit at most this many percentage points below the baseline's. */
export const MAX_PASS_RATE_DROP_POINTS = 2;

/** Process exit code when the comparison ran and the candidate is not on par. */
export const NOT_ON_PAR_EXIT_CODE = 2;

/** The comparison report, written into the candidate batch's directory. */
export const SOURCE_PAR_REPORT_FILENAME = "source-par.md";

/** Prefix of an infrastructure error's failure class. */
export const ERROR_CLASS_PREFIX = "error";

/** Class for an infrastructure error no pattern recognises. */
export const UNRECOGNISED_ERROR_CLASS = "other";

/**
 * Infrastructure error messages, as `studio-runner` words them, mapped to classes. First match wins.
 * An error's class names its kind, so a candidate source that adds a new way of failing — a plan's
 * usage limit surfacing as a distinct studio exit code, say — reads as a new class.
 */
export const ERROR_CLASS_PATTERNS: readonly ErrorClassPattern[] = [
  { pattern: /exceeded its \d+ ms budget/, label: "timeout" },
  // Before the exit-code pattern: this message also begins "Studio exited 0".
  { pattern: /wrote no result file/, label: "no-result" },
  { pattern: /Studio exited on a signal/, label: "killed" },
  { pattern: /Studio exited (\d+)/, label: "exit-$1" },
  { pattern: /on model source/, label: "source-mismatch" },
];
