/**
 * Auth bridge for the muggle-ai dev cycle runner.
 * Implements AuthGuardDeps by bridging to the mcps credential/auth utilities.
 * Credential-loading logic is inlined here (using fs + known data-dir path)
 * so this module does not require @muggleai/mcp as a direct dependency.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import type { AuthGuardDeps, StoredCredentials } from "@muggleai/agents";
import { performLogin } from "@muggleai/mcp";

// ---------------------------------------------------------------------------
// Inline data-dir + credential helpers (mirrors packages/mcps/src/shared/*)
// ---------------------------------------------------------------------------

const DATA_DIR_NAME = ".muggle-ai";
const CREDENTIALS_FILE = "credentials.json";

function getDataDir(): string {
  return path.join(os.homedir(), DATA_DIR_NAME);
}

function getCredentialsFilePath(): string {
  return path.join(getDataDir(), CREDENTIALS_FILE);
}

/** Raw shape stored on disk (expiresAt is an ISO string). */
interface RawStoredCredentials {
  accessToken: string;
  expiresAt: string;
  refreshToken?: string;
}

/**
 * Read credentials from ~/.muggle-ai/credentials.json and return them in the
 * shape expected by AuthGuard (expiresAt as milliseconds number).
 */
function loadCredentialsMapped(): StoredCredentials | null {
  const credentialsPath = getCredentialsFilePath();

  try {
    if (!fs.existsSync(credentialsPath)) {
      return null;
    }

    const content = fs.readFileSync(credentialsPath, "utf-8");
    const raw = JSON.parse(content) as RawStoredCredentials;

    if (!raw.accessToken || !raw.expiresAt) {
      return null;
    }

    return {
      accessToken: raw.accessToken,
      expiresAt: new Date(raw.expiresAt).getTime(),
      refreshToken: raw.refreshToken,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create AuthGuardDeps that bridge to the existing mcps auth/credential utilities.
 *
 * - getCredentials: reads ~/.muggle-ai/credentials.json, converts ISO expiresAt
 *   to milliseconds
 * - startDeviceFlow: runs the full device-code login via performLogin(); logs a
 *   browser prompt and throws on failure
 * - refreshToken: no-op — the mcps auth system handles token refresh internally
 *   via getCallerCredentialsAsync / AuthService
 */
export function createAuthGuardDeps(): AuthGuardDeps {
  return {
    async getCredentials(): Promise<StoredCredentials | null> {
      return loadCredentialsMapped();
    },

    async startDeviceFlow(): Promise<void> {
      console.log(
        "[auth] Starting device authorization flow — please check your browser to complete login.",
      );

      const result = await performLogin();

      if (!result.success) {
        throw new Error(
          `[auth] Device login flow failed: ${result.error ?? "unknown error"}`,
        );
      }

      console.log("[auth] Login successful.");
    },

    async refreshToken(_token: string): Promise<void> {
      // No-op: the mcps auth system handles access-token refresh internally
      // via AuthService.getValidAccessToken() / getCallerCredentialsAsync().
    },
  };
}
