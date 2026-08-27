import { describe, expect, it } from "vitest";

import { buildStudioUserProfile } from "./studio-auth";

const session = {
  userId: "auth0|673d80a77c38fb7c9865559a",
  email: "contacts@muggle-ai.com",
  accessToken: "header.payload.signature",
  refreshToken: "should-never-be-copied",
  expiresAt: "2026-08-27T18:19:24.749Z",
};

describe("buildStudioUserProfile", () => {
  it("maps the muggle session onto studio's UserProfile shape", () => {
    expect(buildStudioUserProfile(session)).toEqual({
      userId: "auth0|673d80a77c38fb7c9865559a",
      nickname: "contacts@muggle-ai.com",
      email: "contacts@muggle-ai.com",
      sessionId: "",
      firebaseSessionToken: "",
      accessToken: "header.payload.signature",
    });
  });

  it("never copies the refresh token into the profile", () => {
    // Studio exchanges its own client credentials for an access token; the
    // refresh token is the long-lived secret and has no business in a file the
    // harness writes per run.
    const profile = buildStudioUserProfile(session);

    expect(JSON.stringify(profile)).not.toContain("should-never-be-copied");
    expect(Object.keys(profile)).not.toContain("refreshToken");
  });

  it("rejects a session missing the fields studio identifies the user by", () => {
    expect(() => buildStudioUserProfile({ ...session, userId: "" })).toThrow(/userId/);
    expect(() => buildStudioUserProfile({ ...session, accessToken: "" })).toThrow(/accessToken/);
  });

  it("names every missing field at once rather than failing on the first", () => {
    expect(() => buildStudioUserProfile({ userId: "", email: "", accessToken: "" })).toThrow(
      /userId.*email.*accessToken/,
    );
  });
});
