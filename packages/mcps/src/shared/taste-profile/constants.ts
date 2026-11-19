/**
 * Constants for the taste profile.
 */

import { TasteDiscipline, TasteSectionUploadStatus } from "./types.js";

/** Directory under the Muggle home directory holding the journal and the profile. */
export const TASTE_DIR_NAME = "taste";

/** Append-only JSONL signal journal file name. */
export const TASTE_SIGNAL_JOURNAL_FILE_NAME = "signals.jsonl";

/** Distilled profile file name. */
export const TASTE_PROFILE_FILE_NAME = "profile.json";

/** Human-readable rendering of the profile, written beside it and never read back. */
export const TASTE_PROFILE_VIEW_FILE_NAME = "profile.md";

/** Per-section record of what was last uploaded. */
export const TASTE_UPLOAD_STATE_FILE_NAME = "upload-state.json";

/** Discipline of a stored preference or a signal that names none. */
export const TASTE_DEFAULT_DISCIPLINE = TasteDiscipline.WebUi;

/** Heading for each discipline in the readable profile, in rendering order. */
export const TASTE_DISCIPLINE_LABELS: Readonly<Record<TasteDiscipline, string>> = {
  [TasteDiscipline.WebUi]: "Web UI",
  [TasteDiscipline.MobileApp]: "Mobile app",
  [TasteDiscipline.VideoEditing]: "Video editing",
  [TasteDiscipline.ImageGeneration]: "Image generation",
  [TasteDiscipline.General]: "General",
};

/** Wording for each section upload status in the readable profile. */
export const TASTE_SECTION_UPLOAD_STATUS_LABELS: Readonly<Record<TasteSectionUploadStatus, string>> = {
  [TasteSectionUploadStatus.NeverUploaded]: "never uploaded",
  [TasteSectionUploadStatus.MatchesUploadedCopy]: "matches uploaded copy",
  [TasteSectionUploadStatus.ChangedSinceUpload]: "changed since upload",
};

/** Most characters one section's statements, contexts and evidence excerpts may total; the backend enforces the same budget. */
export const TASTE_SECTION_CHARACTER_BUDGET = 8000;

/** Most evidence entries one preference may carry; the backend enforces the same limit. */
export const TASTE_EVIDENCE_MAX_PER_PREFERENCE = 3;

/** Most characters one evidence excerpt may hold; the backend enforces the same limit. */
export const TASTE_EVIDENCE_EXCERPT_MAX_CHARACTERS = 300;

/** Section name used for the user-wide section in budget reports. */
export const TASTE_USER_SECTION_NAME = "user";

/** Text that replaces each redacted span. */
export const TASTE_REDACTION_MARKER = "[REDACTED]";

/**
 * Spans removed from every uploaded text before upload. Each pattern is global so every occurrence is
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
