/**
 * Authentication module for @muggleai/mcp.
 * Implements device code flow for user authentication.
 */

import axios, { AxiosError } from "axios";

import { getConfig } from "./config.js";
import {
  deleteCredentials,
  getValidCredentials,
  saveCredentials,
} from "./credentials.js";
import { getLogger } from "./logger.js";
import { openBrowserUrl } from "./open-browser.js";
import type {
  IAuth0Config,
  ICallerCredentials,
  IDeviceCodePollResponse,
  IDeviceCodeResponse,
  IStoredCredentials,
} from "./types.js";

const logger = getLogger();

/**
 * Start the device code authorization flow.
 * Returns a device code and verification URL for the user.
 *
 * @param config - Auth0 configuration.
 * @returns Device code response with URLs and codes.
 * @throws Error if the device code request fails.
 */
export async function startDeviceCodeFlow(config: IAuth0Config): Promise<IDeviceCodeResponse> {
  const deviceCodeUrl = `https://${config.domain}/oauth/device/code`;

  try {
    logger.info("[Auth] Starting device code flow", {
      domain: config.domain,
      clientId: config.clientId,
    });

    const response = await axios.post(
      deviceCodeUrl,
      new URLSearchParams({
        client_id: config.clientId,
        scope: config.scope,
        audience: config.audience,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    const data = response.data;

    logger.info("[Auth] Device code flow started successfully", {
      userCode: data.user_code,
      expiresIn: data.expires_in,
    });

    // Try to open browser automatically
    const browserOpenResult = await openBrowserUrl({
      url: data.verification_uri_complete,
    });

    if (browserOpenResult.opened) {
      logger.info("[Auth] Browser opened for device code login");
    } else {
      logger.warn("[Auth] Failed to open browser", {
        error: browserOpenResult.error,
        verificationUriComplete: data.verification_uri_complete,
      });
    }

    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      verificationUriComplete: data.verification_uri_complete,
      expiresIn: data.expires_in,
      interval: data.interval || 5,
      browserOpened: browserOpenResult.opened,
      browserOpenError: browserOpenResult.error,
    };
  } catch (error) {
    if (error instanceof AxiosError) {
      logger.error("[Auth] Failed to start device code flow", {
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error(
        `Failed to start device code flow: ${error.response?.data?.error_description || error.message}`,
      );
    }
    throw error;
  }
}

/**
 * Poll for device code authorization completion.
 * Should be called at the interval specified in startDeviceCodeFlow response.
 *
 * @param config - Auth0 configuration.
 * @param deviceCode - The device code from startDeviceCodeFlow.
 * @returns Poll response with status and optionally access token.
 */
export async function pollDeviceCode(
  config: IAuth0Config,
  deviceCode: string,
): Promise<IDeviceCodePollResponse> {
  const tokenUrl = `https://${config.domain}/oauth/token`;

  try {
    const response = await axios.post(
      tokenUrl,
      new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: config.clientId,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    logger.info("[Auth] Authorization successful");

    return {
      status: "authorized",
      accessToken: response.data.access_token,
      tokenType: response.data.token_type,
      expiresIn: response.data.expires_in,
    };
  } catch (error) {
    if (error instanceof AxiosError && error.response) {
      const data = error.response.data;
      const errorCode = data.error;

      if (errorCode === "authorization_pending") {
        return {
          status: "authorization_pending",
          error: errorCode,
          errorDescription: data.error_description || "User has not yet authorized",
        };
      }

      if (errorCode === "slow_down") {
        return {
          status: "slow_down",
          error: errorCode,
          errorDescription: data.error_description || "Too many requests, slow down",
        };
      }

      if (errorCode === "expired_token") {
        return {
          status: "expired_token",
          error: errorCode,
          errorDescription: data.error_description || "Device code expired, please restart flow",
        };
      }

      if (errorCode === "access_denied") {
        return {
          status: "access_denied",
          error: errorCode,
          errorDescription: data.error_description || "User denied access",
        };
      }

      logger.error("[Auth] Unexpected error during poll", {
        status: error.response.status,
        error: errorCode,
        description: data.error_description,
      });

      throw new Error(
        `Device code poll failed: ${data.error_description || data.error || "Unknown error"}`,
      );
    }
    throw error;
  }
}

/**
 * Create an API key using an access token.
 * Calls the prompt service API to create a new API key.
 *
 * @param accessToken - Auth0 access token.
 * @param keyName - Optional name for the API key.
 * @param expiry - Expiry option ('30d', '90d', '1y', 'never').
 * @returns Created API key details.
 */
export async function createApiKeyWithToken(
  accessToken: string,
  keyName: string | undefined,
  expiry: "30d" | "90d" | "1y" | "never" = "90d",
): Promise<{
  id: string;
  key: string;
  name: string | null;
  status: string;
  prefix: string;
  lastFour: string;
  createdAt: number;
  expiresAt: number | null;
}> {
  const config = getConfig();
  const apiKeyUrl = `${config.qa.promptServiceBaseUrl}/v1/protected/api-keys`;

  try {
    logger.info("[Auth] Creating API key", {
      keyName: keyName,
      expiry: expiry,
    });

    const response = await axios.post(
      apiKeyUrl,
      {
        name: keyName || "MCP Auto-Generated",
        expiry: expiry,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    logger.info("[Auth] API key created successfully", {
      keyId: response.data.id,
    });

    return response.data;
  } catch (error) {
    if (error instanceof AxiosError) {
      logger.error("[Auth] Failed to create API key", {
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error(
        `Failed to create API key: ${error.response?.data?.message || error.message}`,
      );
    }
    throw error;
  }
}

/**
 * Complete the full device code login flow.
 * Starts the flow, waits for user authorization, and creates credentials.
 *
 * @param keyName - Optional name for the API key.
 * @param keyExpiry - Expiry option for API key.
 * @param timeoutMs - Maximum time to wait for authorization.
 * @returns Result of the login flow.
 */
export async function performLogin(
  keyName?: string,
  keyExpiry: "30d" | "90d" | "1y" | "never" = "90d",
  timeoutMs: number = 120000,
): Promise<{
  success: boolean;
  deviceCodeResponse?: IDeviceCodeResponse;
  credentials?: IStoredCredentials;
  error?: string;
}> {
  const config = getConfig();

  try {
    // Start device code flow
    const deviceCodeResponse = await startDeviceCodeFlow(config.auth0);

    // Poll for completion
    const startTime = Date.now();
    const interval = deviceCodeResponse.interval * 1000;
    let currentInterval = interval;

    while (Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, currentInterval));

      const pollResult = await pollDeviceCode(config.auth0, deviceCodeResponse.deviceCode);

      if (pollResult.status === "authorized" && pollResult.accessToken) {
        // Calculate expiration
        const expiresAt = new Date(
          Date.now() + (pollResult.expiresIn || 86400) * 1000,
        ).toISOString();

        // Create API key for persistent authentication
        const apiKeyResult = await createApiKeyWithToken(
          pollResult.accessToken,
          keyName,
          keyExpiry,
        );

        // Store credentials
        const credentials: IStoredCredentials = {
          accessToken: pollResult.accessToken,
          expiresAt: expiresAt,
          apiKey: apiKeyResult.key,
          apiKeyId: apiKeyResult.id,
        };

        saveCredentials(credentials);

        return {
          success: true,
          deviceCodeResponse: deviceCodeResponse,
          credentials: credentials,
        };
      }

      if (pollResult.status === "slow_down") {
        // Increase polling interval
        currentInterval = Math.min(currentInterval + 1000, 15000);
        continue;
      }

      if (pollResult.status === "expired_token") {
        return {
          success: false,
          error: "Device code expired. Please try again.",
        };
      }

      if (pollResult.status === "access_denied") {
        return {
          success: false,
          error: "Access denied. User did not authorize the request.",
        };
      }

      // authorization_pending - continue polling
    }

    return {
      success: false,
      deviceCodeResponse: deviceCodeResponse,
      error: "Timeout waiting for user authorization",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Perform logout by clearing credentials.
 */
export function performLogout(): void {
  deleteCredentials();
  logger.info("[Auth] Logged out successfully");
}

/**
 * Get caller credentials for API requests.
 * Returns credentials from storage if available and valid.
 * @returns Caller credentials or empty object.
 */
export function getCallerCredentials(): ICallerCredentials {
  const credentials = getValidCredentials();

  if (!credentials) {
    return {};
  }

  // Prefer API key if available (longer lived)
  if (credentials.apiKey) {
    return { apiKey: credentials.apiKey };
  }

  // Fall back to bearer token
  return { bearerToken: credentials.accessToken };
}

/**
 * Check if authentication is required for the given tool.
 * Local-only tools don't require auth.
 * @param toolName - Name of the tool.
 * @returns True if tool requires authentication.
 */
export function toolRequiresAuth(toolName: string): boolean {
  // Local tools that don't require auth
  const noAuthTools = [
    // Auth tools (remote tools that don't require prior auth)
    "muggle-remote-auth-status",
    "muggle-remote-auth-login",
    "muggle-remote-auth-poll",
    "muggle-remote-auth-logout",
    // Local project tools (no cloud)
    "muggle-local-project-create",
    "muggle-local-project-list",
    "muggle-local-project-get",
    "muggle-local-project-update",
    "muggle-local-project-delete",
    "muggle-local-use-case-save",
    "muggle-local-use-case-list",
    "muggle-local-use-case-get",
    "muggle-local-use-case-update",
    "muggle-local-use-case-delete",
    "muggle-local-test-case-save",
    "muggle-local-test-case-list",
    "muggle-local-test-case-get",
    "muggle-local-test-case-update",
    "muggle-local-test-case-delete",
    "muggle-local-test-script-save",
    "muggle-local-test-script-list",
    "muggle-local-test-script-get",
    "muggle-local-test-script-delete",
    "muggle-local-execute-test-generation",
    "muggle-local-execute-replay",
    "muggle-local-cancel-execution",
    "muggle-local-check-status",
    "muggle-local-list-sessions",
    "muggle-local-cleanup-sessions",
    "muggle-local-get-page-state",
    "muggle-local-run-test",
    "muggle-local-explore-page",
    "muggle-local-execute-action",
    "muggle-local-get-screenshot",
    "muggle-local-run-result-list",
    "muggle-local-run-result-get",
    "muggle-local-secret-create",
    "muggle-local-secret-list",
    "muggle-local-secret-get",
    "muggle-local-secret-update",
    "muggle-local-secret-delete",
    "muggle-local-workflow-file-create",
    "muggle-local-workflow-file-list",
    "muggle-local-workflow-file-list-available",
    "muggle-local-workflow-file-get",
    "muggle-local-workflow-file-update",
    "muggle-local-workflow-file-delete",
    "muggle-local-publish-test-script",
  ];

  return !noAuthTools.includes(toolName);
}
