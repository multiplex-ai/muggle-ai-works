/**
 * Constants for the taste profile.
 */

/** Directory under the Muggle home directory holding the journal and the profile. */
export const TASTE_DIR_NAME = "taste";

/** Append-only JSONL signal journal file name. */
export const TASTE_SIGNAL_JOURNAL_FILE_NAME = "signals.jsonl";

/** Distilled profile file name. */
export const TASTE_PROFILE_FILE_NAME = "profile.json";

/** Most characters the statements of one section may total; the backend enforces the same budget. */
export const TASTE_SECTION_STATEMENT_CHARACTER_BUDGET = 4000;

/** Section name used for the user-wide section in budget reports. */
export const TASTE_USER_SECTION_NAME = "user";

/** Text that replaces each redacted span. */
export const TASTE_REDACTION_MARKER = "[REDACTED]";

/**
 * Spans removed from a statement before upload. Each pattern is global so every occurrence is
 * replaced. Order matters: a private key block goes first so no later pattern cuts it into
 * pieces, and `key=value` pairs go next so a token they carry is redacted once, with its key.
 */
export const TASTE_REDACTION_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|credential|session)s?\s*[=:]\s*\S+/gi,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@\S*/gi,
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g,
];
