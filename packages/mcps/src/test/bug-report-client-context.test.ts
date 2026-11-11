import { describe, expect, it } from "vitest";

import {
  BUG_REPORT_CONTEXT_VALUE_MAX_LENGTH,
  isSecretLikeValue,
  sanitizeBugReportClientContext,
} from "../shared/bug-report/index.js";

describe("isSecretLikeValue", () => {
  it.each([
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"],
    ["a bearer header", "Bearer abc.def"],
    ["a key assignment", "api_key=12345"],
    ["a password assignment", "password: hunter2"],
    ["a URL with credentials", "https://admin:hunter2@example.com/app"],
    ["a payment secret key", "sk_live_51Habcdefghijkl"],
    ["a GitHub token", "ghp_abcdefghijklmnopqrstuvwxyz0123456789"],
    ["a cloud access key", "AKIAABCDEFGHIJKLMNOP"],
    ["a private key", "-----BEGIN RSA PRIVATE KEY-----"],
    ["a long opaque token", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"],
  ])("flags %s", (_label, secretValue) => {
    expect(isSecretLikeValue(secretValue)).toBe(true);
  });

  it.each([
    ["a version", "5.35.0-staging.331"],
    ["an operating system", "win32 10.0.26200 x64"],
    ["a dashed id", "11111111-1111-4111-8111-111111111111"],
    ["a dashboard path", "/muggleTestV0/dashboard/projects/11111111-1111-4111-8111-111111111111/scripts"],
    ["a run status", "failed"],
    ["a browser user agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"],
  ])("keeps %s", (_label, safeValue) => {
    expect(isSecretLikeValue(safeValue)).toBe(false);
  });
});

describe("sanitizeBugReportClientContext", () => {
  it("drops secret-looking values and names the fields it dropped", () => {
    const sanitizedContext = sanitizeBugReportClientContext({
      cliVersion: "5.35.0",
      lastProjectId: "token=abc123",
      lastLocalRunId: "Bearer xyz",
    });

    expect(sanitizedContext).toEqual({
      clientContext: { cliVersion: "5.35.0" },
      strippedFieldNames: ["lastProjectId", "lastLocalRunId"],
    });
  });

  it("drops unknown keys, non-string values and blank values", () => {
    const sanitizedContext = sanitizeBugReportClientContext({
      os: "linux 6.8.0 x64",
      homeDirectory: "/home/someone",
      studioVersion: 1.25,
      lastLocalRunStatus: "   ",
    });

    expect(sanitizedContext).toEqual({ clientContext: { os: "linux 6.8.0 x64" }, strippedFieldNames: [] });
  });

  it("cuts a long value to the backend's limit", () => {
    const longPagePath = `/${"page-".repeat(200)}`;

    const sanitizedContext = sanitizeBugReportClientContext({ pagePath: longPagePath });

    expect(sanitizedContext.clientContext.pagePath).toHaveLength(BUG_REPORT_CONTEXT_VALUE_MAX_LENGTH);
  });

  it.each([undefined, null, "context", 42])("returns an empty context for %s", (rawClientContext) => {
    expect(sanitizeBugReportClientContext(rawClientContext)).toEqual({ clientContext: {}, strippedFieldNames: [] });
  });
});
