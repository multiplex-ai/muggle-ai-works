import {
  BUG_REPORT_CLIENT_CONTEXT_FIELDS,
  BUG_REPORT_CONTEXT_VALUE_MAX_LENGTH,
  BUG_REPORT_SECRET_VALUE_PATTERNS,
} from "./bug-report-constants.js";
import type {
  BugReportClientContextField,
  IBugReportClientContext,
  ISanitizedBugReportClientContext,
} from "./bug-report-types.js";

/**
 * Whether a value has the shape of a token, key, password or credentialed URL.
 * @param candidateValue - Context value to test.
 * @returns True when any secret pattern matches.
 */
export function isSecretLikeValue(candidateValue: string): boolean {
  return BUG_REPORT_SECRET_VALUE_PATTERNS.some((secretPattern) => secretPattern.test(candidateValue));
}

/**
 * Keep only the known client context fields with a non-empty string value that does not look like a
 * secret, each cut to the backend's length limit.
 * @param rawClientContext - Context as gathered or passed in; any shape.
 * @returns The context safe to send and the fields dropped as secret-looking.
 *
 * Output shape: `{ clientContext: { cliVersion: "5.35.0", os: "linux 6.8.0 x64" }, strippedFieldNames: [] }`
 */
export function sanitizeBugReportClientContext(rawClientContext: unknown): ISanitizedBugReportClientContext {
  const clientContext: IBugReportClientContext = {};
  const strippedFieldNames: BugReportClientContextField[] = [];
  if (rawClientContext === null || typeof rawClientContext !== "object") {
    return { clientContext: clientContext, strippedFieldNames: strippedFieldNames };
  }

  const rawFields = rawClientContext as Record<string, unknown>;
  for (const fieldName of BUG_REPORT_CLIENT_CONTEXT_FIELDS) {
    const fieldValue = rawFields[fieldName];
    if (typeof fieldValue !== "string" || fieldValue.trim() === "") {
      continue;
    }
    if (isSecretLikeValue(fieldValue)) {
      strippedFieldNames.push(fieldName);
      continue;
    }
    clientContext[fieldName] = fieldValue.trim().slice(0, BUG_REPORT_CONTEXT_VALUE_MAX_LENGTH);
  }
  return { clientContext: clientContext, strippedFieldNames: strippedFieldNames };
}
