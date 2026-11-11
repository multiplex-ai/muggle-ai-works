import type { BugReportClientContextField } from "./bug-report-types.js";

/** Prompt-service route of the filer's bug reports. */
export const BUG_REPORTS_PATH = "/v1/protected/bug-reports";

/** Multipart field carrying a new report's JSON payload. */
export const BUG_REPORT_PAYLOAD_FIELD = "payload";

/** Multipart field carrying a reply's text. */
export const BUG_REPORT_REPLY_MESSAGE_FIELD = "message";

/** Multipart field each screenshot is sent under. */
export const BUG_REPORT_SCREENSHOTS_FIELD = "screenshots";

/** Most screenshots one report or reply may carry. */
export const BUG_REPORT_MAX_SCREENSHOTS = 5;

/** Largest screenshot accepted, in bytes. */
export const BUG_REPORT_MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/** Image content type for each screenshot file extension accepted. */
export const BUG_REPORT_SCREENSHOT_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** Largest page of reports the list route returns. */
export const BUG_REPORT_LIST_MAX_PAGE_SIZE = 50;

/** Longest title accepted. */
export const BUG_REPORT_TITLE_MAX_LENGTH = 200;

/** Longest description, steps, expected or actual text accepted. */
export const BUG_REPORT_TEXT_MAX_LENGTH = 10_000;

/** Longest reply message accepted. */
export const BUG_REPORT_MESSAGE_MAX_LENGTH = 5_000;

/** Longest client context value sent; longer values are cut. */
export const BUG_REPORT_CONTEXT_VALUE_MAX_LENGTH = 500;

/** Shape of the short id shown to people, as in "BUG-4821". */
export const BUG_REPORT_SHORT_ID_PATTERN = /^BUG-\d+$/i;

/** Every client context field the backend keeps; any other key is dropped. */
export const BUG_REPORT_CLIENT_CONTEXT_FIELDS: BugReportClientContextField[] = [
  "pagePath",
  "userAgent",
  "workspaceId",
  "projectId",
  "uiRelease",
  "cliVersion",
  "studioVersion",
  "os",
  "lastProjectId",
  "lastLocalRunId",
  "lastLocalRunStatus",
];

/** Value shapes that look like a credential; a context value matching any of them is never sent. */
export const BUG_REPORT_SECRET_VALUE_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/,
  /\bbearer\s+\S+/i,
  /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth|credential|session)s?\s*[=:]/i,
  /[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?=[A-Za-z0-9_]*\d)(?=[A-Za-z0-9_]*[A-Za-z])[A-Za-z0-9_]{32,}\b/,
];
