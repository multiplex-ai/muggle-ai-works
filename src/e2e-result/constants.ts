import { UnpassedCaseStatus } from "./types.js";

/**
 * Opens the hidden line a walkthrough uses to carry its E2E result record.
 * Versioned separately from the walkthrough sentinel so the record's shape can
 * change without every walkthrough recogniser following it.
 */
export const E2E_RESULT_MARKER_PREFIX = "<!-- muggle-e2e-result:v1 ";

/** Closes the hidden result line. */
export const E2E_RESULT_MARKER_SUFFIX = " -->";

/** Longest error or reason a record keeps per case; the walkthrough's details table holds the full text. */
export const UNPASSED_DETAIL_MAX_CHARS = 300;

/** Emoji each non-passing outcome renders with, matching the walkthrough's per-test status. */
export const UNPASSED_STATUS_EMOJI: Record<UnpassedCaseStatus, string> = {
  [UnpassedCaseStatus.Failed]: "❌",
  [UnpassedCaseStatus.Inconclusive]: "⚠️",
};
