import { UnpassedCaseStatus } from "./types.js";

/**
 * Opens the hidden line a walkthrough uses to carry its E2E result record.
 * Versioned separately from the walkthrough sentinel so the record's shape can
 * change without every walkthrough recogniser following it.
 */
export const E2E_RESULT_MARKER_PREFIX = "<!-- muggle-e2e-result:v1 ";

/** Closes the hidden result line. */
export const E2E_RESULT_MARKER_SUFFIX = " -->";

/** The marker of a reference GitHub autolinks to an issue or pull request in rendered text: `#106`, `GH-106`. */
export const ISSUE_REFERENCE_MARKER = /(#|\bGH-)(?=\d)/gi;

/**
 * Splits an issue reference's marker from its digits. Renders as nothing and copies as nothing, and GitHub no
 * longer reads the pair as one reference; an escaped `&#35;` would not do, it is decoded before the autolinker runs.
 */
export const ISSUE_REFERENCE_BREAK = "<!-- -->";

/** Longest error or reason a record keeps per case; the walkthrough's details table holds the full text. */
export const UNPASSED_DETAIL_MAX_CHARS = 300;

/** Emoji each non-passing outcome renders with, matching the walkthrough's per-test status. */
export const UNPASSED_STATUS_EMOJI: Record<UnpassedCaseStatus, string> = {
  [UnpassedCaseStatus.Failed]: "❌",
  [UnpassedCaseStatus.Inconclusive]: "⚠️",
};
