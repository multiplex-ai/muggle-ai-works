/**
 * Auth types for local E2E acceptance module.
 */

import type { DeviceCodePollStatus } from "./enums.js";

/**
 * Auth0 configuration.
 */
export interface IAuth0Config {
  /** Auth0 domain. */
  domain: string;
  /** Auth0 client ID. */
  clientId: string;
  /** Auth0 client secret (optional, for client credentials). */
  clientSecret?: string;
  /** Auth0 audience. */
  audience: string;
  /** Auth0 scopes. */
  scopes: string[];
}

/**
 * Authentication status.
 */
export interface IAuthStatus {
  /** Whether the user is authenticated. */
  authenticated: boolean;
  /** User email address. */
  email?: string;
  /** User ID. */
  userId?: string;
  /** Token expiration time. */
  expiresAt?: string;
  /** Whether the token is expired. */
  isExpired?: boolean;
}

/**
 * Device code flow response.
 */
export interface IDeviceCodeResponse {
  /** The device code. */
  deviceCode: string;
  /** The user code to enter. */
  userCode: string;
  /** Verification URI. */
  verificationUri: string;
  /** Complete verification URI. */
  verificationUriComplete: string;
  /** Seconds until the code expires. */
  expiresIn: number;
  /** Polling interval in seconds. */
  interval: number;
  /** Whether the browser was opened. */
  browserOpened?: boolean;
  /** Error opening browser. */
  browserOpenError?: string;
}

/**
 * Device code poll result.
 */
export interface IDeviceCodePollResult {
  /** Poll status. */
  status: DeviceCodePollStatus;
  /** Human-readable message. */
  message: string;
  /** User email (on success). */
  email?: string;
  /** Error message (on error). */
  error?: string;
}

/**
 * Token response from Auth0.
 */
export interface ITokenResponse {
  /** Access token. */
  accessToken: string;
  /** Refresh token (optional). */
  refreshToken?: string;
  /** Token type (usually "Bearer"). */
  tokenType: string;
  /** Seconds until expiration. */
  expiresIn: number;
}

/**
 * Stored authentication data.
 */
export interface IStoredAuth {
  /** Access token. */
  accessToken: string;
  /** Refresh token. */
  refreshToken?: string;
  /** Expiration timestamp (ISO string). */
  expiresAt: string;
  /** User email. */
  email?: string;
  /** User ID. */
  userId?: string;
}
