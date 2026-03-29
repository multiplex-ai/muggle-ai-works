/**
 * API key storage for @muggleai/works.
 * Manages persistent storage of long-lived API keys.
 */

import * as fs from "fs";
import * as path from "path";

import { getDataDir } from "./data-dir.js";
import { getLogger } from "./logger.js";
import type { IStoredCredentials } from "./types.js";

/** API key file name. */
const API_KEY_FILE = "api-key.json";

/**
 * Get the path to the API key file.
 * @returns Path to api-key.json
 */
export function getApiKeyFilePath(): string {
  return path.join(getDataDir(), API_KEY_FILE);
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
 * Load stored API key data from disk.
 * @returns Stored API key data, or null if not found or invalid.
 */
export function loadApiKeyData(): IStoredCredentials | null {
  const logger = getLogger();
  const apiKeyPath = getApiKeyFilePath();

  try {
    if (!fs.existsSync(apiKeyPath)) {
      logger.debug("No API key file found", { path: apiKeyPath });
      return null;
    }

    const content = fs.readFileSync(apiKeyPath, "utf-8");
    const data = JSON.parse(content) as IStoredCredentials;

    return data;
  } catch (error) {
    logger.warn("Failed to load API key data", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Save API key data to disk.
 * @param data - API key data to save.
 */
export function saveApiKeyData(data: IStoredCredentials): void {
  const logger = getLogger();
  const apiKeyPath = getApiKeyFilePath();

  try {
    ensureDataDir();

    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(apiKeyPath, content, { mode: 0o600 });

    logger.info("API key saved", { path: apiKeyPath });
  } catch (error) {
    logger.error("Failed to save API key", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Delete stored API key data.
 */
export function deleteApiKeyData(): void {
  const logger = getLogger();
  const apiKeyPath = getApiKeyFilePath();

  try {
    if (fs.existsSync(apiKeyPath)) {
      fs.unlinkSync(apiKeyPath);
      logger.info("API key deleted", { path: apiKeyPath });
    }
  } catch (error) {
    logger.warn("Failed to delete API key", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get valid API key data if available.
 * Server validates API key expiry, so we just check if it exists.
 * @returns Valid API key data or null.
 */
export function getValidApiKeyData(): IStoredCredentials | null {
  const data = loadApiKeyData();

  if (!data) {
    return null;
  }

  if (data.apiKey) {
    return data;
  }

  return null;
}

/**
 * Check if an API key is stored.
 * @returns True if API key exists.
 */
export function hasApiKey(): boolean {
  const data = loadApiKeyData();
  return !!data?.apiKey;
}

/**
 * Get stored API key if available.
 * @returns API key or null.
 */
export function getApiKey(): string | null {
  const data = loadApiKeyData();
  return data?.apiKey ?? null;
}

/**
 * Save API key to storage.
 * @param params - API key payload.
 * @param params.apiKey - The API key to save.
 * @param params.apiKeyId - The API key ID.
 */
export function saveApiKey(params: { apiKey: string; apiKeyId: string }): void {
  const logger = getLogger();
  const apiKeyPath = getApiKeyFilePath();

  try {
    ensureDataDir();

    const data: IStoredCredentials = {
      accessToken: "",
      expiresAt: "",
      apiKey: params.apiKey,
      apiKeyId: params.apiKeyId,
    };

    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(apiKeyPath, content, { mode: 0o600 });

    logger.info("API key saved", { path: apiKeyPath });
  } catch (error) {
    logger.error("Failed to save API key", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * @deprecated Use loadApiKeyData instead. Kept for backward compatibility.
 */
export const loadCredentials = loadApiKeyData;

/**
 * @deprecated Use saveApiKeyData instead. Kept for backward compatibility.
 */
export const saveCredentials = saveApiKeyData;

/**
 * @deprecated Use deleteApiKeyData instead. Kept for backward compatibility.
 */
export const deleteCredentials = deleteApiKeyData;

/**
 * @deprecated Use getValidApiKeyData instead. Kept for backward compatibility.
 */
export const getValidCredentials = getValidApiKeyData;

/**
 * @deprecated Use getApiKeyFilePath instead. Kept for backward compatibility.
 */
export const getCredentialsFilePath = getApiKeyFilePath;
