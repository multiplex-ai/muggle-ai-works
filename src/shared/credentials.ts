/**
 * Credentials storage for @muggleai/works.
 * Manages persistent storage of authentication credentials.
 */

import * as fs from "fs";
import * as path from "path";

import { getDataDir } from "./config.js";
import { getLogger } from "./logger.js";
import type { IStoredCredentials } from "./types.js";

/** Credentials file name. */
const CREDENTIALS_FILE = "credentials.json";

/**
 * Get the path to the credentials file.
 * @returns Path to credentials.json
 */
export function getCredentialsFilePath(): string {
  return path.join(getDataDir(), CREDENTIALS_FILE);
}

/**
 * Ensure the data directory exists.
 */
function ensureDataDir(): void {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

/**
 * Load stored credentials from disk.
 * @returns Stored credentials, or null if not found or invalid.
 */
export function loadCredentials(): IStoredCredentials | null {
  const logger = getLogger();
  const credentialsPath = getCredentialsFilePath();

  try {
    if (!fs.existsSync(credentialsPath)) {
      logger.debug("No credentials file found", { path: credentialsPath });
      return null;
    }

    const content = fs.readFileSync(credentialsPath, "utf-8");
    const credentials = JSON.parse(content) as IStoredCredentials;

    // Validate required fields
    if (!credentials.accessToken || !credentials.expiresAt) {
      logger.warn("Invalid credentials file - missing required fields");
      return null;
    }

    return credentials;
  } catch (error) {
    logger.warn("Failed to load credentials", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Save credentials to disk.
 * @param credentials - Credentials to save.
 */
export function saveCredentials(credentials: IStoredCredentials): void {
  const logger = getLogger();
  const credentialsPath = getCredentialsFilePath();

  try {
    ensureDataDir();

    const content = JSON.stringify(credentials, null, 2);
    fs.writeFileSync(credentialsPath, content, { mode: 0o600 });

    logger.info("Credentials saved", { path: credentialsPath });
  } catch (error) {
    logger.error("Failed to save credentials", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Delete stored credentials.
 */
export function deleteCredentials(): void {
  const logger = getLogger();
  const credentialsPath = getCredentialsFilePath();

  try {
    if (fs.existsSync(credentialsPath)) {
      fs.unlinkSync(credentialsPath);
      logger.info("Credentials deleted", { path: credentialsPath });
    }
  } catch (error) {
    logger.warn("Failed to delete credentials", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Check if credentials are expired.
 * @param credentials - Credentials to check.
 * @returns True if expired.
 */
export function isCredentialsExpired(credentials: IStoredCredentials): boolean {
  const expiresAt = new Date(credentials.expiresAt);
  const now = new Date();

  // Consider expired 5 minutes before actual expiry for safety
  const bufferMs = 5 * 60 * 1000;
  return now.getTime() >= expiresAt.getTime() - bufferMs;
}

/**
 * Get valid credentials if available.
 * This is primarily used for API key storage.
 * Access token authentication is handled by AuthService.
 * @returns Valid credentials or null.
 */
export function getValidCredentials(): IStoredCredentials | null {
  const credentials = loadCredentials();

  if (!credentials) {
    return null;
  }

  // Return credentials if API key exists (server validates expiry)
  if (credentials.apiKey) {
    return credentials;
  }

  return null;
}

/**
 * Check if an API key is stored.
 * @returns True if API key exists.
 */
export function hasApiKey(): boolean {
  const credentials = loadCredentials();
  return !!credentials?.apiKey;
}

/**
 * Get stored API key if available.
 * @returns API key or null.
 */
export function getApiKey(): string | null {
  const credentials = loadCredentials();
  return credentials?.apiKey ?? null;
}

/**
 * Save API key to credentials.
 * @param apiKey - The API key to save.
 * @param apiKeyId - The API key ID.
 */
export function saveApiKey(params: { apiKey: string; apiKeyId: string }): void {
  const logger = getLogger();
  const credentialsPath = getCredentialsFilePath();

  try {
    ensureDataDir();

    const credentials: IStoredCredentials = {
      accessToken: "",
      expiresAt: "",
      apiKey: params.apiKey,
      apiKeyId: params.apiKeyId,
    };

    const content = JSON.stringify(credentials, null, 2);
    fs.writeFileSync(credentialsPath, content, { mode: 0o600 });

    logger.info("API key saved", { path: credentialsPath });
  } catch (error) {
    logger.error("Failed to save API key", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
