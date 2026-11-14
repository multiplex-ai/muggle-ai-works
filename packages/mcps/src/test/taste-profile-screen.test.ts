/** Tests for the pre-upload taste profile screen. */

import { describe, expect, it } from "vitest";

import { TASTE_REDACTION_MARKER } from "../shared/taste-profile/constants.js";
import { screenTasteProfile } from "../shared/taste-profile/taste-profile-screen.js";
import { TasteCategory, type ITasteProfile } from "../shared/taste-profile/types.js";

function buildProfile(userStatements: string[], projectStatements: string[] = []): ITasteProfile {
  const toSection = (statements: string[]) => ({
    preferences: statements.map((statement) => ({
      statement: statement,
      category: TasteCategory.QualityBar,
      signalCount: 1,
      lastSeenAt: "2026-11-01T00:00:00.000Z",
    })),
    distilledAt: "2026-11-02T00:00:00.000Z",
  });
  return {
    userSection: toSection(userStatements),
    projectSections: projectStatements.length > 0 ? { p1: toSection(projectStatements) } : {},
  };
}

function screenOne(statement: string): { statement: string; redactionCount: number } {
  const screenResult = screenTasteProfile(buildProfile([statement]));
  return {
    statement: screenResult.screenedProfile.userSection!.preferences[0].statement,
    redactionCount: screenResult.redactionCount,
  };
}

describe("screenTasteProfile", () => {
  it.each([
    ["an OpenAI-style key", "Use sk-abcdefghijklmnop1234 for tests", "sk-abcdefghijklmnop1234"],
    ["a Stripe key", "Billing uses sk_live_abcdef123456", "sk_live_abcdef123456"],
    ["a GitHub token", "token ghp_abcdefghijklmnopqrstuvwxyz0123", "ghp_abcdefghijklmnopqrstuvwxyz0123"],
    ["an AWS key id", "Deploy as AKIAABCDEFGHIJKLMNOP", "AKIAABCDEFGHIJKLMNOP"],
    ["a JWT", "Send eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4", "eyJhbGciOiJIUzI1"],
    ["a bearer token", "Header Bearer abcdefghijklmnop", "abcdefghijklmnop"],
    ["an email", "Ask jane.doe@example.com before merging", "jane.doe@example.com"],
    ["a password pair", "Log in with password=hunter22", "hunter22"],
    ["an api_key pair", "Set api_key: abc123", "abc123"],
    ["credentials in a URL", "DB at postgres://admin:s3cret@db.local/app", "s3cret"],
    ["a long mixed token", "Seed a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6 first", "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6"],
  ])("redacts %s", (_label, statement, secretSpan) => {
    const screened = screenOne(statement);
    expect(screened.statement).not.toContain(secretSpan);
    expect(screened.statement).toContain(TASTE_REDACTION_MARKER);
    expect(screened.redactionCount).toBeGreaterThanOrEqual(1);
  });

  it("redacts a private key block as one span", () => {
    const screened = screenOne(
      "Never commit -----BEGIN RSA PRIVATE KEY-----\nMIIEow1234abcd\n-----END RSA PRIVATE KEY----- again",
    );
    expect(screened.statement).toBe(`Never commit ${TASTE_REDACTION_MARKER} again`);
    expect(screened.redactionCount).toBe(1);
  });

  it("counts a token inside a key=value pair once", () => {
    const screened = screenOne("token=ghp_abcdefghijklmnopqrstuvwxyz0123 is wrong");
    expect(screened.statement).toBe(`${TASTE_REDACTION_MARKER} is wrong`);
    expect(screened.redactionCount).toBe(1);
  });

  it("leaves ordinary taste untouched", () => {
    const screened = screenOne("Primary buttons sit bottom-right and use sentence case; errors appear inline under the field.");
    expect(screened.statement).toBe("Primary buttons sit bottom-right and use sentence case; errors appear inline under the field.");
    expect(screened.redactionCount).toBe(0);
  });

  it("screens every section, sums the count and does not modify the input", () => {
    const profile = buildProfile(["mail a@b.co"], ["mail c@d.io", "and e@f.org"]);
    const screenResult = screenTasteProfile(profile);

    expect(screenResult.redactionCount).toBe(3);
    expect(screenResult.screenedProfile.projectSections.p1.preferences.map((preference) => preference.statement)).toEqual([
      `mail ${TASTE_REDACTION_MARKER}`,
      `and ${TASTE_REDACTION_MARKER}`,
    ]);
    expect(profile.userSection!.preferences[0].statement).toBe("mail a@b.co");
  });

  it("keeps a null user section null", () => {
    const screenResult = screenTasteProfile({ userSection: null, projectSections: {} });
    expect(screenResult).toEqual({ screenedProfile: { userSection: null, projectSections: {} }, redactionCount: 0 });
  });
});
