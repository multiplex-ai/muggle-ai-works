/**
 * Shared type definitions for @muggleai/mcp.
 */

/**
 * Auth0 configuration for device code flow.
 */
export interface IAuth0Config {
  /** Auth0 domain (e.g., login.muggle-ai.com). */
  domain: string;
  /** Auth0 client ID for device code grant. */
  clientId: string;
  /** Auth0 API audience. */
  audience: string;
  /** OAuth scopes to request. */
  scope: string;
}

/**
 * Stored credentials from device code authentication.
 */
export interface IStoredCredentials {
  /** Access token for API calls. */
  accessToken: string;
  /** Token expiration timestamp (ISO string). */
  expiresAt: string;
  /** User ID. */
  userId?: string;
  /** User email. */
  email?: string;
  /** API key (if created). */
  apiKey?: string;
  /** API key ID (if created). */
  apiKeyId?: string;
}

/**
 * Configuration for QA Gateway (cloud) operations.
 */
export interface IQaConfig {
  /** Base URL of the prompt service backend. */
  promptServiceBaseUrl: string;
  /** Request timeout in milliseconds. */
  requestTimeoutMs: number;
  /** Workflow timeout in milliseconds. */
  workflowTimeoutMs: number;
}

/**
 * Configuration for Local QA operations.
 */
export interface ILocalQaConfig {
  /** Base URL of the local web-service. */
  webServiceUrl: string;
  /** Base URL of the prompt service (for cloud sync). */
  promptServiceUrl: string;
  /** Path to data directory. */
  dataDir: string;
  /** Path to sessions directory. */
  sessionsDir: string;
  /** Path to projects directory. */
  projectsDir: string;
  /** Path to temp directory. */
  tempDir: string;
  /** Path to credentials file. */
  credentialsFilePath: string;
  /** Path to auth file (local auth storage). */
  authFilePath: string;
  /** Path to electron-app executable (null if not installed). */
  electronAppPath: string | null;
  /** Path to web-service entry point (null if not found). */
  webServicePath: string | null;
  /** Path to web-service PID file. */
  webServicePidFile: string;
  /** Auth0 configuration for local auth. */
  auth0: ILocalAuth0Config;
}

/**
 * Auth0 configuration for local auth (with scopes array).
 */
export interface ILocalAuth0Config {
  /** Auth0 domain. */
  domain: string;
  /** Auth0 client ID. */
  clientId: string;
  /** Auth0 audience. */
  audience: string;
  /** OAuth scopes to request (as array). */
  scopes: string[];
}

/**
 * Unified configuration for @muggleai/mcp.
 */
export interface IConfig {
  /** Server name for MCP protocol. */
  serverName: string;
  /** Server version. */
  serverVersion: string;
  /** Log level. */
  logLevel: string;
  /** Auth0 configuration. */
  auth0: IAuth0Config;
  /** QA Gateway configuration. */
  qa: IQaConfig;
  /** Local QA configuration. */
  localQa: ILocalQaConfig;
}

/**
 * Caller credentials for API requests.
 */
export interface ICallerCredentials {
  /** Bearer token (from device code flow or config). */
  bearerToken?: string;
  /** API key (from device code flow or config). */
  apiKey?: string;
}

/**
 * Device code flow response from Auth0.
 */
export interface IDeviceCodeResponse {
  /** Device code for polling. */
  deviceCode: string;
  /** User-visible code to enter. */
  userCode: string;
  /** URL for user to visit. */
  verificationUri: string;
  /** URL with code pre-filled. */
  verificationUriComplete: string;
  /** Seconds until code expires. */
  expiresIn: number;
  /** Polling interval in seconds. */
  interval: number;
  /** Whether browser was successfully opened. */
  browserOpened: boolean;
  /** Error message if browser failed to open. */
  browserOpenError?: string;
}

/**
 * Device code poll response.
 */
export interface IDeviceCodePollResponse {
  /** Poll status. */
  status: "authorized" | "authorization_pending" | "slow_down" | "expired_token" | "access_denied";
  /** Access token (when authorized). */
  accessToken?: string;
  /** Token type (when authorized). */
  tokenType?: string;
  /** Token expiry in seconds (when authorized). */
  expiresIn?: number;
  /** Error code (when not authorized). */
  error?: string;
  /** Error description (when not authorized). */
  errorDescription?: string;
}

/**
 * MCP tool result structure.
 */
export interface IMcpToolResult {
  /** Result content (text). */
  content: string;
  /** Whether this is an error result. */
  isError?: boolean;
}

/**
 * MCP tool definition.
 */
export interface IMcpTool {
  /** Tool name. */
  name: string;
  /** Tool description. */
  description: string;
  /** Input schema (Zod schema). */
  inputSchema: unknown;
  /** Whether tool requires authentication (default: true for QA tools). */
  requiresAuth?: boolean;
  /** Execute the tool. */
  execute: (params: { input: unknown; correlationId: string }) => Promise<IMcpToolResult>;
}
