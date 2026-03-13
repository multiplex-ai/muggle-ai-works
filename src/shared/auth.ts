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
    // Auth tools
    "muggle_auth_status",
    "muggle_auth_login",
    "muggle_auth_poll",
    "muggle_auth_logout",
    // Local project tools (no cloud)
    "muggle_project_create",
    "muggle_project_list",
    "muggle_project_get",
    "muggle_project_update",
    "muggle_project_delete",
    "muggle_use_case_save",
    "muggle_use_case_list",
    "muggle_use_case_get",
    "muggle_use_case_update",
    "muggle_use_case_delete",
    "muggle_test_case_save",
    "muggle_test_case_list",
    "muggle_test_case_get",
    "muggle_test_case_update",
    "muggle_test_case_delete",
    "muggle_test_script_save",
    "muggle_test_script_list",
    "muggle_test_script_get",
    "muggle_test_script_delete",
    "muggle_execute_test_generation",
    "muggle_execute_replay",
    "muggle_cancel_execution",
    "muggle_check_status",
    "muggle_list_sessions",
    "muggle_cleanup_sessions",
    "muggle_get_page_state",
    "muggle_run_test",
    "muggle_explore_page",
    "muggle_execute_action",
    "muggle_get_screenshot",
    "muggle_run_result_list",
    "muggle_run_result_get",
    "muggle_secret_create",
    "muggle_secret_list",
    "muggle_secret_get",
    "muggle_secret_update",
    "muggle_secret_delete",
    "muggle_workflow_file_create",
    "muggle_workflow_file_list",
    "muggle_workflow_file_list_available",
    "muggle_workflow_file_get",
    "muggle_workflow_file_update",
    "muggle_workflow_file_delete",
  ];

  return !noAuthTools.includes(toolName);
}
