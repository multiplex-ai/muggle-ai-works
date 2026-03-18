/**
 * Configuration management for @muggleai/mcp.
 * Unified configuration for both QA Gateway and Local QA.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

import type {
  IAuth0Config,
  IConfig,
  ILocalQaConfig,
  IMuggleConfig,
  IMuggleConfigChecksums,
  IQaConfig,
} from "./types.js";

/** Default prompt service URL (cloud API). */
const DEFAULT_PROMPT_SERVICE_PRODUCTION_URL = "https://promptservice.muggle-ai.com";

/** Default prompt service URL for local development usage. */
const DEFAULT_PROMPT_SERVICE_DEV_URL = "http://localhost:5050";

/** Default web-service URL (local test execution). */
const DEFAULT_WEB_SERVICE_URL = "http://localhost:3001";

/** Default data directory name. */
const DATA_DIR_NAME = ".muggle-ai";

/** Subdirectory for downloaded electron-app binaries. */
const ELECTRON_APP_DIR = "electron-app";

/** Credentials file name. */
const CREDENTIALS_FILE = "credentials.json";

/** Default Auth0 domain (custom domain for production). */
const DEFAULT_AUTH0_PRODUCTION_DOMAIN = "login.muggle-ai.com";

/** Default Auth0 client ID (Native app with Device Code grant) for production. */
const DEFAULT_AUTH0_PRODUCTION_CLIENT_ID = "UgG5UjoyLksxMciWWKqVpwfWrJ4rFvtT";

/** Default Auth0 audience for production. */
const DEFAULT_AUTH0_PRODUCTION_AUDIENCE = "https://muggleai.us.auth0.com/api/v2/";

/** Default Auth0 domain for local development. */
const DEFAULT_AUTH0_DEV_DOMAIN = "dev-po4mxmz0rd8a0w8w.us.auth0.com";

/** Default Auth0 client ID for local development. */
const DEFAULT_AUTH0_DEV_CLIENT_ID = "hihMM2cxb40yHaZMH2MMXwO2ZRJQ3MxA";

/** Default Auth0 audience for local development. */
const DEFAULT_AUTH0_DEV_AUDIENCE = "https://dev-po4mxmz0rd8a0w8w.us.auth0.com/api/v2/";

/** Default Auth0 scopes. */
const DEFAULT_AUTH0_SCOPE = "openid profile email offline_access";

/** Cached configuration instance. */
let configInstance: IConfig | null = null;

/** Cached muggle config from package.json. */
let muggleConfigCache: IMuggleConfig | null = null;

/** Allowed runtime targets for PromptService defaults. */
type PromptServiceRuntimeTarget = "production" | "dev";

/**
 * Resolve the package root directory from the current module location.
 * @returns The package root directory path.
 */
function getPackageRoot(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFilePath);

  // Handle bundled (dist/) and development (src/) contexts
  // With tsup bundling, code is in dist/ directly (e.g., dist/cli.js)
  // With tsc, code is in dist/shared/ (e.g., dist/shared/config.js)
  
  if (currentDir.includes(path.join("dist", "shared"))) {
    // Navigate up from dist/shared to package root (2 levels)
    return path.resolve(currentDir, "..", "..");
  }

  if (currentDir.endsWith("dist")) {
    // Navigate up from dist to package root (1 level) - tsup bundled
    return path.resolve(currentDir, "..");
  }

  if (currentDir.includes(path.join("src", "shared"))) {
    // Navigate up from src/shared to package root (2 levels)
    return path.resolve(currentDir, "..", "..");
  }

  return path.dirname(currentDir);
}

/**
 * Get the muggle config from package.json.
 * @returns The muggle config with electronAppVersion, downloadBaseUrl, and checksums.
 * @throws Error if package.json cannot be read or muggleConfig is missing/invalid.
 */
function getMuggleConfig(): IMuggleConfig {
  if (muggleConfigCache) {
    return muggleConfigCache;
  }

  const packageRoot = getPackageRoot();
  const packageJsonPath = path.join(packageRoot, "package.json");

  let packageJson: Record<string, unknown>;
  try {
    const content = fs.readFileSync(packageJsonPath, "utf-8");
    packageJson = JSON.parse(content);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read package.json for muggleConfig.\n` +
      `  Path: ${packageJsonPath}\n` +
      `  Package root: ${packageRoot}\n` +
      `  Error: ${errorMessage}\n` +
      `  This is a bug - please report it.`
    );
  }

  const config = packageJson.muggleConfig as Record<string, unknown> | undefined;

  if (!config) {
    throw new Error(
      `Missing muggleConfig in package.json.\n` +
      `  Path: ${packageJsonPath}\n` +
      `  This is a bug - please report it.`
    );
  }

  if (!config.electronAppVersion || typeof config.electronAppVersion !== "string") {
    throw new Error(
      `Missing or invalid muggleConfig.electronAppVersion in package.json.\n` +
      `  Path: ${packageJsonPath}\n` +
      `  Value: ${JSON.stringify(config.electronAppVersion)}\n` +
      `  This is a bug - please report it.`
    );
  }

  if (!config.downloadBaseUrl || typeof config.downloadBaseUrl !== "string") {
    throw new Error(
      `Missing or invalid muggleConfig.downloadBaseUrl in package.json.\n` +
      `  Path: ${packageJsonPath}\n` +
      `  Value: ${JSON.stringify(config.downloadBaseUrl)}\n` +
      `  This is a bug - please report it.`
    );
  }

  if (
    config.runtimeTargetDefault !== undefined &&
    config.runtimeTargetDefault !== "production" &&
    config.runtimeTargetDefault !== "dev"
  ) {
    throw new Error(
      `Invalid muggleConfig.runtimeTargetDefault in package.json.\n` +
        `  Path: ${packageJsonPath}\n` +
        `  Value: ${JSON.stringify(config.runtimeTargetDefault)}\n` +
        `  Expected: "production" or "dev"\n` +
        `  This is a bug - please report it.`,
    );
  }

  muggleConfigCache = {
    electronAppVersion: config.electronAppVersion,
    downloadBaseUrl: config.downloadBaseUrl,
    checksums: (config.checksums as IMuggleConfigChecksums) || {},
    runtimeTargetDefault: config.runtimeTargetDefault as PromptServiceRuntimeTarget | undefined,
  };

  return muggleConfigCache;
}

/**
 * Get the Muggle AI data directory path.
 * @returns Path to ~/.muggle-ai
 */
export function getDataDir(): string {
  return path.join(os.homedir(), DATA_DIR_NAME);
}

/**
 * Get the path to the downloaded electron-app binary for the current platform.
 * @returns The path to the downloaded binary, or null if not found.
 */
function getDownloadedElectronAppPath(): string | null {
  const platform = os.platform();
  const config = getMuggleConfig();
  const version = config.electronAppVersion;

  const baseDir = path.join(getDataDir(), ELECTRON_APP_DIR, version);

  let binaryPath: string;

  switch (platform) {
    case "darwin":
      binaryPath = path.join(baseDir, "MuggleAI.app", "Contents", "MacOS", "MuggleAI");
      break;
    case "win32":
      binaryPath = path.join(baseDir, "MuggleAI.exe");
      break;
    case "linux":
      binaryPath = path.join(baseDir, "MuggleAI");
      break;
    default:
      return null;
  }

  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  return null;
}

/**
 * Get the path to the electron-app in well-known system locations.
 * @returns The path to the system-installed binary, or null if not found.
 */
function getSystemElectronAppPath(): string | null {
  const platform = os.platform();
  const homeDir = os.homedir();

  let binaryPath: string;

  switch (platform) {
    case "darwin":
      binaryPath = path.join(homeDir, "Applications", "MuggleAI.app", "Contents", "MacOS", "MuggleAI");
      break;
    case "win32":
      binaryPath = path.join(homeDir, "AppData", "Local", "Programs", "MuggleAI", "MuggleAI.exe");
      break;
    case "linux":
      binaryPath = path.join(homeDir, ".local", "share", "muggle-ai", "MuggleAI");
      break;
    default:
      return null;
  }

  if (fs.existsSync(binaryPath)) {
    return binaryPath;
  }

  return null;
}

/**
 * Resolve the electron-app executable path if available.
 * @returns The path to the electron-app executable, or null when not installed.
 */
function resolveElectronAppPathOrNull(): string | null {
  // 1. Check environment override
  const customPath = process.env.ELECTRON_APP_PATH;
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }

  // 2. Check downloaded binary
  const downloadedPath = getDownloadedElectronAppPath();
  if (downloadedPath) {
    return downloadedPath;
  }

  // 3. Check system location
  const systemPath = getSystemElectronAppPath();
  if (systemPath) {
    return systemPath;
  }

  return null;
}

/**
 * Resolve the web-service entry point path.
 * @returns The path to the web-service index.js, or null if not found.
 */
function resolveWebServicePath(): string | null {
  const customPath = process.env.WEB_SERVICE_PATH;
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }

  // Check sibling package path (monorepo structure)
  const packageRoot = getPackageRoot();
  const siblingPath = path.resolve(packageRoot, "..", "web-service", "dist", "src", "index.js");

  if (fs.existsSync(siblingPath)) {
    return siblingPath;
  }

  return null;
}

/**
 * Parse an integer environment variable with a default value.
 * @param value - Environment variable value.
 * @param defaultValue - Default value if not set or invalid.
 * @returns Parsed integer.
 */
function parseInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === "") {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Resolve runtime target for prompt-service defaults.
 * Priority order:
 * 1. MUGGLE_MCP_PROMPT_SERVICE_TARGET env var ("production" | "dev")
 * 2. muggleConfig.runtimeTargetDefault from package.json
 * 3. Default fallback -> "dev"
 * @returns Prompt service runtime target.
 */
function getPromptServiceRuntimeTarget(): PromptServiceRuntimeTarget {
  const runtimeTargetFromEnv = process.env.MUGGLE_MCP_PROMPT_SERVICE_TARGET;

  if (runtimeTargetFromEnv) {
    if (runtimeTargetFromEnv === "production" || runtimeTargetFromEnv === "dev") {
      return runtimeTargetFromEnv;
    }

    throw new Error(
      `Invalid MUGGLE_MCP_PROMPT_SERVICE_TARGET value: '${runtimeTargetFromEnv}'. ` +
        "Expected 'production' or 'dev'.",
    );
  }

  const muggleConfig = getMuggleConfig();
  if (muggleConfig.runtimeTargetDefault) {
    return muggleConfig.runtimeTargetDefault;
  }

  return "dev";
}

/**
 * Get default prompt-service URL based on runtime target.
 * @returns Default prompt-service URL.
 */
function getDefaultPromptServiceUrl(): string {
  const runtimeTarget = getPromptServiceRuntimeTarget();
  if (runtimeTarget === "dev") {
    return DEFAULT_PROMPT_SERVICE_DEV_URL;
  }
  return DEFAULT_PROMPT_SERVICE_PRODUCTION_URL;
}

/**
 * Get default Auth0 domain based on runtime target.
 * @returns Default Auth0 domain.
 */
function getDefaultAuth0Domain(): string {
  const runtimeTarget = getPromptServiceRuntimeTarget();
  if (runtimeTarget === "dev") {
    return DEFAULT_AUTH0_DEV_DOMAIN;
  }
  return DEFAULT_AUTH0_PRODUCTION_DOMAIN;
}

/**
 * Get default Auth0 client ID based on runtime target.
 * @returns Default Auth0 client ID.
 */
function getDefaultAuth0ClientId(): string {
  const runtimeTarget = getPromptServiceRuntimeTarget();
  if (runtimeTarget === "dev") {
    return DEFAULT_AUTH0_DEV_CLIENT_ID;
  }
  return DEFAULT_AUTH0_PRODUCTION_CLIENT_ID;
}

/**
 * Get default Auth0 audience based on runtime target.
 * @returns Default Auth0 audience.
 */
function getDefaultAuth0Audience(): string {
  const runtimeTarget = getPromptServiceRuntimeTarget();
  if (runtimeTarget === "dev") {
    return DEFAULT_AUTH0_DEV_AUDIENCE;
  }
  return DEFAULT_AUTH0_PRODUCTION_AUDIENCE;
}

/**
 * Build Auth0 configuration from environment.
 * @returns Auth0 configuration.
 */
function buildAuth0Config(): IAuth0Config {
  const defaultAuth0Domain = getDefaultAuth0Domain();
  const defaultAuth0ClientId = getDefaultAuth0ClientId();
  const defaultAuth0Audience = getDefaultAuth0Audience();

  return {
    domain: process.env.AUTH0_DOMAIN ?? defaultAuth0Domain,
    clientId: process.env.AUTH0_CLIENT_ID ?? defaultAuth0ClientId,
    audience: process.env.AUTH0_AUDIENCE ?? defaultAuth0Audience,
    scope: process.env.AUTH0_SCOPE ?? DEFAULT_AUTH0_SCOPE,
  };
}

/**
 * Build QA Gateway configuration from environment.
 * @returns QA Gateway configuration.
 */
function buildQaConfig(): IQaConfig {
  const defaultPromptServiceUrl = getDefaultPromptServiceUrl();

  return {
    promptServiceBaseUrl: process.env.PROMPT_SERVICE_BASE_URL ?? defaultPromptServiceUrl,
    requestTimeoutMs: parseInteger(process.env.REQUEST_TIMEOUT_MS, 30000),
    workflowTimeoutMs: parseInteger(process.env.WORKFLOW_TIMEOUT_MS, 120000),
  };
}

/**
 * Build Local QA configuration from environment.
 * @returns Local QA configuration.
 */
function buildLocalQaConfig(): ILocalQaConfig {
  const dataDir = getDataDir();
  const auth0Scopes = (process.env.AUTH0_SCOPE ?? DEFAULT_AUTH0_SCOPE).split(" ");
  const defaultPromptServiceUrl = getDefaultPromptServiceUrl();
  const defaultAuth0Domain = getDefaultAuth0Domain();
  const defaultAuth0ClientId = getDefaultAuth0ClientId();
  const defaultAuth0Audience = getDefaultAuth0Audience();

  return {
    webServiceUrl: process.env.WEB_SERVICE_URL ?? DEFAULT_WEB_SERVICE_URL,
    promptServiceUrl: process.env.PROMPT_SERVICE_BASE_URL ?? defaultPromptServiceUrl,
    dataDir: dataDir,
    sessionsDir: path.join(dataDir, "sessions"),
    projectsDir: path.join(dataDir, "projects"),
    tempDir: path.join(dataDir, "temp"),
    credentialsFilePath: path.join(dataDir, CREDENTIALS_FILE),
    authFilePath: path.join(dataDir, "auth.json"),
    electronAppPath: resolveElectronAppPathOrNull(),
    webServicePath: resolveWebServicePath(),
    webServicePidFile: path.join(dataDir, "web-service.pid"),
    auth0: {
      domain: process.env.AUTH0_DOMAIN ?? defaultAuth0Domain,
      clientId: process.env.AUTH0_CLIENT_ID ?? defaultAuth0ClientId,
      audience: process.env.AUTH0_AUDIENCE ?? defaultAuth0Audience,
      scopes: auth0Scopes,
    },
  };
}

/**
 * Get the unified application configuration.
 * @returns The application configuration.
 */
export function getConfig(): IConfig {
  if (configInstance) {
    return configInstance;
  }

  configInstance = {
    serverName: "muggle-mcp",
    serverVersion: "1.0.0",
    logLevel: process.env.LOG_LEVEL ?? "info",
    auth0: buildAuth0Config(),
    qa: buildQaConfig(),
    localQa: buildLocalQaConfig(),
  };

  return configInstance;
}

/**
 * Reset the configuration (for testing).
 */
export function resetConfig(): void {
  configInstance = null;
  muggleConfigCache = null;
}

/** Filename for storing the overridden electron-app version. */
const VERSION_OVERRIDE_FILE = "electron-app-version-override.json";

/** Environment variable name for overriding electron-app version. */
const ELECTRON_APP_VERSION_ENV = "ELECTRON_APP_VERSION";

/**
 * Get the effective electron-app version.
 * Priority order:
 * 1. ELECTRON_APP_VERSION env var (for testing/development)
 * 2. Override file (set by `muggle-mcp upgrade`)
 * 3. package.json muggleConfig.electronAppVersion (bundled default)
 * @returns The electron-app version string.
 */
export function getElectronAppVersion(): string {
  // Check environment variable first (highest priority)
  const envVersion = process.env[ELECTRON_APP_VERSION_ENV];
  if (envVersion && /^\d+\.\d+\.\d+$/.test(envVersion)) {
    return envVersion;
  }

  // Check override file (set by muggle-mcp upgrade)
  const overridePath = path.join(getDataDir(), VERSION_OVERRIDE_FILE);

  if (fs.existsSync(overridePath)) {
    try {
      const content = JSON.parse(fs.readFileSync(overridePath, "utf-8"));
      if (content.version && typeof content.version === "string") {
        return content.version;
      }
    } catch {
      // Fall through to default
    }
  }

  // Fall back to bundled version
  return getMuggleConfig().electronAppVersion;
}

/**
 * Get the source of the current electron-app version.
 * @returns The version source: "env", "override", or "bundled".
 */
export function getElectronAppVersionSource(): "env" | "override" | "bundled" {
  // Check environment variable
  const envVersion = process.env[ELECTRON_APP_VERSION_ENV];
  if (envVersion && /^\d+\.\d+\.\d+$/.test(envVersion)) {
    return "env";
  }

  // Check override file
  const overridePath = path.join(getDataDir(), VERSION_OVERRIDE_FILE);
  if (fs.existsSync(overridePath)) {
    try {
      const content = JSON.parse(fs.readFileSync(overridePath, "utf-8"));
      if (content.version && typeof content.version === "string") {
        return "override";
      }
    } catch {
      // Fall through
    }
  }

  return "bundled";
}

/**
 * Get the bundled electron-app version from package.json (ignores override).
 * @returns The bundled electron-app version string.
 */
export function getBundledElectronAppVersion(): string {
  return getMuggleConfig().electronAppVersion;
}

/**
 * Get the download base URL for electron-app binaries.
 * @returns The base URL for downloads.
 */
export function getDownloadBaseUrl(): string {
  return getMuggleConfig().downloadBaseUrl;
}

/**
 * Get the checksums for electron-app binaries.
 * @returns Checksums map by platform, or undefined if not configured.
 */
export function getElectronAppChecksums(): IMuggleConfigChecksums | undefined {
  return getMuggleConfig().checksums;
}

/**
 * Check if the electron-app binary is installed for the expected version.
 * @returns True if the binary is installed and accessible.
 */
export function isElectronAppInstalled(): boolean {
  return getDownloadedElectronAppPath() !== null;
}

/**
 * Get the electron-app directory path for a specific version.
 * @param version - Version string (defaults to configured version).
 * @returns Path to the electron-app version directory.
 */
export function getElectronAppDir(version?: string): string {
  const ver = version ?? getElectronAppVersion();
  return path.join(getDataDir(), ELECTRON_APP_DIR, ver);
}
