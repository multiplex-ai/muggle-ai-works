import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dataDirHolder = vi.hoisted(() => ({ path: "" }));

vi.mock("../shared/data-dir.js", () => ({
  getDataDir: () => dataDirHolder.path,
}));

import { getActiveRuntimeTarget, getConfig, resetConfig } from "../shared/config.js";
import { getAuthService, resetAuthService } from "../mcp/local/services/auth-service.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const RENEWED_ACCESS_TOKEN = "renewed-access-token";
const RENEWED_LIFETIME_SEC = 86400;

/**
 * Write a stored session whose access token lapsed an hour ago.
 * @param refreshToken - Refresh token to store alongside it.
 */
function writeLapsedSession(refreshToken: string | undefined): void {
  const sessionFilePath = getConfig().localQa.oauthSessionFilePath;
  fs.mkdirSync(path.dirname(sessionFilePath), { recursive: true });
  fs.writeFileSync(
    sessionFilePath,
    JSON.stringify({
      accessToken: "lapsed-access-token",
      refreshToken: refreshToken,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      email: "user@example.com",
      userId: "auth0|user-1",
      runtimeTarget: getActiveRuntimeTarget(),
    }),
  );
}

/**
 * Stub Auth0's token endpoint.
 * @param isRefreshAccepted - Whether the refresh grant succeeds.
 */
function stubTokenEndpoint(isRefreshAccepted: boolean): ReturnType<typeof vi.fn> {
  const fetchStub = vi.fn(async () => {
    if (!isRefreshAccepted) {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 403 });
    }
    return new Response(
      JSON.stringify({
        access_token: RENEWED_ACCESS_TOKEN,
        token_type: "Bearer",
        expires_in: RENEWED_LIFETIME_SEC,
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

/**
 * Invoke the muggle-remote-auth-status tool's handler.
 */
async function callAuthStatusTool(): Promise<Record<string, unknown>> {
  const authStatusTool = getQaToolByName("muggle-remote-auth-status");
  if (!authStatusTool?.localHandler) {
    throw new Error("muggle-remote-auth-status has no local handler");
  }
  return (await authStatusTool.localHandler({})) as Record<string, unknown>;
}

beforeEach(() => {
  dataDirHolder.path = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-auth-renewal-"));
  resetConfig();
  resetAuthService();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dataDirHolder.path, { recursive: true, force: true });
  resetConfig();
  resetAuthService();
});

describe("muggle-remote-auth-status with a lapsed access token", () => {
  // Auth0 issues 24h access tokens beside a refresh token that outlives them,
  // so reporting the lapse as expiry sent users through a fresh login daily.
  it("renews from the refresh token and reports the session authenticated", async () => {
    writeLapsedSession("valid-refresh-token");
    const fetchStub = stubTokenEndpoint(true);

    const authStatus = await callAuthStatusTool();

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(authStatus.authenticated).toBe(true);
    expect(authStatus.email).toBe("user@example.com");
    expect(new Date(authStatus.expiresAt as string).getTime()).toBeGreaterThan(Date.now());
    expect(getAuthService().loadStoredAuth()?.accessToken).toBe(RENEWED_ACCESS_TOKEN);
  });

  it("reports unauthenticated when Auth0 rejects the refresh token", async () => {
    writeLapsedSession("revoked-refresh-token");
    stubTokenEndpoint(false);

    const authStatus = await callAuthStatusTool();

    expect(authStatus.authenticated).toBe(false);
  });

  it("reports unauthenticated without calling Auth0 when no refresh token is stored", async () => {
    writeLapsedSession(undefined);
    const fetchStub = stubTokenEndpoint(true);

    const authStatus = await callAuthStatusTool();

    expect(fetchStub).not.toHaveBeenCalled();
    expect(authStatus.authenticated).toBe(false);
  });
});
