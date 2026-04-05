/**
 * Auth service for Auth0 authentication in local E2E acceptance execution.
 * Supports Device Code flow for user authentication.
 */

import * as fs from "fs";
import * as path from "path";

import { getConfig } from "../../../shared/config.js";
import { getLogger } from "../../../shared/logger.js";
import { openBrowserUrl } from "../../../shared/open-browser.js";
import type {
  IAuthStatus,
  IDeviceCodePollResult,
  IDeviceCodeResponse,
  IStoredAuth,
  ITokenResponse,
} from "../types/index.js";
import { DeviceCodePollStatus } from "../types/index.js";

/** Default timeout for waiting on browser login completion. */
const DEFAULT_LOGIN_WAIT_TIMEOUT_MS = 120000;

/**
 * Service for handling Auth0 authentication.
 */
export class AuthService {
  /** Path to the OAuth session file. */
  private readonly oauthSessionFilePath: string;

  /** Path to the pending device code file. */
  private readonly pendingDeviceCodePath: string;

  /**
   * Create a new AuthService.
   */
  constructor() {
    const config = getConfig();
    this.oauthSessionFilePath = config.localQa.oauthSessionFilePath;
    this.pendingDeviceCodePath = path.join(
      path.dirname(config.localQa.oauthSessionFilePath),
      "pending-device-code.json",
    );
  }

  /**
   * Get current authentication status.
   */
  getAuthStatus(): IAuthStatus {
    const logger = getLogger();
    const storedAuth = this.loadStoredAuth();

    if (!storedAuth) {
      logger.debug("No stored auth found");
      return { authenticated: false };
    }

    const now = new Date();
    const expiresAt = new Date(storedAuth.expiresAt);
    const isExpired = now >= expiresAt;

    logger.debug("Auth status checked", {
      email: storedAuth.email,
      isExpired: isExpired,
      expiresAt: storedAuth.expiresAt,
    });

    return {
      authenticated: !isExpired,
      email: storedAuth.email,
      userId: storedAuth.userId,
      expiresAt: storedAuth.expiresAt,
      isExpired: isExpired,
    };
  }

  /**
   * Start the device code flow.
   */
  async startDeviceCodeFlow(): Promise<IDeviceCodeResponse> {
    const logger = getLogger();
    const config = getConfig();
    const { domain, clientId, audience, scopes } = config.localQa.auth0;

    logger.info("Starting device code flow");

    const url = `https://${domain}/oauth/device/code`;
    const body = new URLSearchParams({
      client_id: clientId,
      scope: scopes.join(" "),
      audience: audience,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Device code request failed", {
        status: response.status,
        error: errorText,
      });
      throw new Error(`Failed to start device code flow: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      verification_uri_complete: string;
      expires_in: number;
      interval: number;
    };

    logger.info("Device code flow started", {
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
    });

    this.storePendingDeviceCode({
      deviceCode: data.device_code,
      userCode: data.user_code,
      expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    });

    const browserOpenResult = await openBrowserUrl({
      url: data.verification_uri_complete,
    });

    if (browserOpenResult.opened) {
      logger.info("Browser opened for device code login");
    } else {
      logger.warn("Failed to open browser for device code login", {
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
      interval: data.interval,
      browserOpened: browserOpenResult.opened,
      browserOpenError: browserOpenResult.error,
    };
  }

  /**
   * Store a pending device code for later retrieval.
   */
  private storePendingDeviceCode(params: {
    deviceCode: string;
    userCode: string;
    expiresAt: string;
  }): void {
    const logger = getLogger();

    const dir = path.dirname(this.pendingDeviceCodePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.pendingDeviceCodePath, JSON.stringify(params, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });

    logger.debug("Pending device code stored", { userCode: params.userCode });
  }

  /**
   * Get the pending device code if one exists and is not expired.
   */
  getPendingDeviceCode(): string | null {
    const logger = getLogger();

    if (!fs.existsSync(this.pendingDeviceCodePath)) {
      logger.debug("No pending device code found");
      return null;
    }

    try {
      const content = fs.readFileSync(this.pendingDeviceCodePath, "utf-8");
      const data = JSON.parse(content) as {
        deviceCode: string;
        userCode: string;
        expiresAt: string;
      };

      const now = new Date();
      const expiresAt = new Date(data.expiresAt);

      if (now >= expiresAt) {
        logger.debug("Pending device code expired");
        this.clearPendingDeviceCode();
        return null;
      }

      return data.deviceCode;
    } catch (error) {
      logger.warn("Failed to read pending device code", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Clear the pending device code file.
   */
  private clearPendingDeviceCode(): void {
    const logger = getLogger();

    if (fs.existsSync(this.pendingDeviceCodePath)) {
      try {
        fs.unlinkSync(this.pendingDeviceCodePath);
        logger.debug("Pending device code cleared");
      } catch (error) {
        logger.warn("Failed to clear pending device code", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Poll for device code authorization completion.
   */
  async pollDeviceCode(deviceCode: string): Promise<IDeviceCodePollResult> {
    const logger = getLogger();
    const config = getConfig();
    const { domain, clientId } = config.localQa.auth0;

    logger.debug("Polling for device code authorization");

    const url = `https://${domain}/oauth/token`;
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: deviceCode,
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (response.ok) {
        const tokenData = (await response.json()) as {
          access_token: string;
          refresh_token?: string;
          token_type: string;
          expires_in: number;
        };

        const tokenResponse: ITokenResponse = {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          tokenType: tokenData.token_type,
          expiresIn: tokenData.expires_in,
        };

        const userInfo = await this.getUserInfo(tokenResponse.accessToken);

        await this.storeAuth({
          tokenResponse: tokenResponse,
          email: userInfo.email,
          userId: userInfo.sub,
        });

        this.clearPendingDeviceCode();

        logger.info("Device code authorization complete", { email: userInfo.email });

        return {
          status: DeviceCodePollStatus.Complete,
          message: "Authentication successful!",
          email: userInfo.email,
        };
      }

      const errorData = (await response.json()) as { error: string; error_description?: string };

      if (errorData.error === "authorization_pending") {
        logger.debug("Authorization pending");
        return {
          status: DeviceCodePollStatus.Pending,
          message: "Waiting for user to complete authorization...",
        };
      }

      if (errorData.error === "slow_down") {
        logger.debug("Polling too fast");
        return {
          status: DeviceCodePollStatus.Pending,
          message: "Polling too fast, slowing down...",
        };
      }

      if (errorData.error === "expired_token") {
        logger.warn("Device code expired");
        return {
          status: DeviceCodePollStatus.Expired,
          message: "The authorization code has expired. Please start again.",
        };
      }

      if (errorData.error === "access_denied") {
        logger.warn("Access denied");
        return {
          status: DeviceCodePollStatus.Error,
          message: "Access was denied by the user.",
          error: errorData.error_description ?? errorData.error,
        };
      }

      logger.error("Unexpected error during polling", { error: errorData });
      return {
        status: DeviceCodePollStatus.Error,
        message: errorData.error_description ?? errorData.error,
        error: errorData.error,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Poll request failed", { error: errorMessage });
      return {
        status: DeviceCodePollStatus.Error,
        message: `Poll request failed: ${errorMessage}`,
        error: errorMessage,
      };
    }
  }

  /**
   * Poll for device code authorization until completion or timeout.
   */
  async waitForDeviceCodeAuthorization(params: {
    deviceCode: string;
    intervalSeconds: number;
    timeoutMs?: number;
  }): Promise<IDeviceCodePollResult> {
    const logger = getLogger();
    const timeoutMs = params.timeoutMs ?? DEFAULT_LOGIN_WAIT_TIMEOUT_MS;
    const pollIntervalMs = Math.max(params.intervalSeconds, 1) * 1000;
    const startedAt = Date.now();

    logger.info("Waiting for device code authorization", {
      timeoutMs: timeoutMs,
      pollIntervalMs: pollIntervalMs,
    });

    while (Date.now() - startedAt < timeoutMs) {
      const result = await this.pollDeviceCode(params.deviceCode);

      if (result.status !== DeviceCodePollStatus.Pending) {
        return result;
      }

      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) {
        break;
      }

      await sleep({ durationMs: Math.min(pollIntervalMs, remainingMs) });
    }

    return {
      status: DeviceCodePollStatus.Pending,
      message:
        "Timed out waiting for browser login confirmation. Please finish login in your browser, then call `muggle_auth_poll` to continue.",
    };
  }

  /**
   * Get user info from Auth0.
   */
  private async getUserInfo(accessToken: string): Promise<{ email?: string; sub?: string }> {
    const logger = getLogger();
    const config = getConfig();
    const { domain } = config.localQa.auth0;

    const url = `https://${domain}/userinfo`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        logger.warn("Failed to get user info", { status: response.status });
        return {};
      }

      const data = (await response.json()) as { email?: string; sub?: string };
      return data;
    } catch (error) {
      logger.warn("User info request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * Store authentication tokens.
   */
  private async storeAuth(params: {
    tokenResponse: ITokenResponse;
    email?: string;
    userId?: string;
  }): Promise<void> {
    const { tokenResponse, email, userId } = params;
    const logger = getLogger();

    const expiresAt = new Date(Date.now() + tokenResponse.expiresIn * 1000).toISOString();

    const storedAuth: IStoredAuth = {
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
      expiresAt: expiresAt,
      email: email,
      userId: userId,
    };

    const dir = path.dirname(this.oauthSessionFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.oauthSessionFilePath, JSON.stringify(storedAuth, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });

    logger.info("Auth stored successfully", { email: email, expiresAt: expiresAt });
  }

  /**
   * Load stored authentication.
   */
  loadStoredAuth(): IStoredAuth | null {
    const logger = getLogger();

    if (!fs.existsSync(this.oauthSessionFilePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(this.oauthSessionFilePath, "utf-8");
      return JSON.parse(content) as IStoredAuth;
    } catch (error) {
      logger.error("Failed to load stored auth", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get the current access token (if valid).
   * Does not auto-refresh - use getValidAccessToken() for that.
   */
  getAccessToken(): string | null {
    const storedAuth = this.loadStoredAuth();

    if (!storedAuth) {
      return null;
    }

    const now = new Date();
    const expiresAt = new Date(storedAuth.expiresAt);

    if (now >= expiresAt) {
      return null;
    }

    return storedAuth.accessToken;
  }

  /**
   * Check if the access token is expired or about to expire.
   * Uses a 5-minute buffer for safety.
   */
  isAccessTokenExpired(): boolean {
    const storedAuth = this.loadStoredAuth();

    if (!storedAuth) {
      return true;
    }

    const now = new Date();
    const expiresAt = new Date(storedAuth.expiresAt);
    const bufferMs = 5 * 60 * 1000;

    return now.getTime() >= expiresAt.getTime() - bufferMs;
  }

  /**
   * Refresh the access token using the stored refresh token.
   * @returns New access token or null if refresh failed.
   */
  async refreshAccessToken(): Promise<string | null> {
    const logger = getLogger();
    const storedAuth = this.loadStoredAuth();

    if (!storedAuth?.refreshToken) {
      logger.debug("No refresh token available");
      return null;
    }

    const config = getConfig();
    const { domain, clientId } = config.localQa.auth0;

    logger.info("Refreshing access token");

    const url = `https://${domain}/oauth/token`;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: storedAuth.refreshToken,
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Token refresh failed", {
          status: response.status,
          error: errorText,
        });
        return null;
      }

      const tokenData = (await response.json()) as {
        access_token: string;
        refresh_token?: string;
        token_type: string;
        expires_in: number;
      };

      const newExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      const updatedAuth: IStoredAuth = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? storedAuth.refreshToken,
        expiresAt: newExpiresAt,
        email: storedAuth.email,
        userId: storedAuth.userId,
      };

      const dir = path.dirname(this.oauthSessionFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.oauthSessionFilePath, JSON.stringify(updatedAuth, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });

      logger.info("Access token refreshed", { expiresAt: newExpiresAt });

      return tokenData.access_token;
    } catch (error) {
      logger.error("Token refresh request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Get a valid access token, refreshing if necessary.
   * This is the preferred method for getting an access token for API calls.
   * @returns Valid access token or null if not authenticated or refresh failed.
   */
  async getValidAccessToken(): Promise<string | null> {
    const logger = getLogger();
    const storedAuth = this.loadStoredAuth();

    if (!storedAuth) {
      logger.debug("No stored auth, cannot get valid token");
      return null;
    }

    // Check if token is strictly expired (past expiresAt)
    const now = new Date();
    const expiresAt = new Date(storedAuth.expiresAt);
    const isStrictlyExpired = now >= expiresAt;

    // If not strictly expired, return the token
    // (we'll still try to refresh in the buffer zone, but won't fail if refresh fails)
    if (!isStrictlyExpired && !this.isAccessTokenExpired()) {
      return storedAuth.accessToken;
    }

    // Token is in buffer zone or expired - try to refresh
    if (!isStrictlyExpired) {
      logger.debug("Access token in buffer zone, attempting proactive refresh");
    } else {
      logger.info("Access token expired, attempting refresh");
    }

    const refreshedToken = await this.refreshAccessToken();

    if (refreshedToken) {
      return refreshedToken;
    }

    // If refresh failed but token isn't strictly expired, still use it
    if (!isStrictlyExpired) {
      logger.warn("Token refresh failed, but token not yet expired - using existing token");
      return storedAuth.accessToken;
    }

    logger.warn("Token refresh failed and token is expired, user needs to re-authenticate");
    return null;
  }

  /**
   * Clear stored authentication (logout).
   */
  logout(): boolean {
    const logger = getLogger();

    if (!fs.existsSync(this.oauthSessionFilePath)) {
      logger.debug("No auth to clear");
      return false;
    }

    try {
      fs.unlinkSync(this.oauthSessionFilePath);
      logger.info("Auth cleared successfully");
      return true;
    } catch (error) {
      logger.error("Failed to clear auth", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

/** Cached service instance. */
let serviceInstance: AuthService | null = null;

/**
 * Get the singleton AuthService instance.
 */
export function getAuthService(): AuthService {
  serviceInstance ??= new AuthService();
  return serviceInstance;
}

/**
 * Reset the service (for testing).
 */
export function resetAuthService(): void {
  serviceInstance = null;
}

/**
 * Sleep for the requested duration.
 */
function sleep(params: { durationMs: number }): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, params.durationMs);
  });
}
