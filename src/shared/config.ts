/**
 * Configuration management for @muggleai/mcp.
 * Unified configuration for both QA Gateway and Local QA.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

import type { IAuth0Config, IConfig, ILocalQaConfig, IQaConfig } from "./types.js";

/** Default prompt service URL (cloud API). */
const DEFAULT_PROMPT_SERVICE_URL = "https://promptservice.muggle-ai.com";

/** Default web-service URL (local test execution). */
const DEFAULT_WEB_SERVICE_URL = "http://localhost:3001";

/** Default data directory name. */
const DATA_DIR_NAME = ".muggle-ai";

/** Subdirectory for downloaded electron-app binaries. */
const ELECTRON_APP_DIR = "electron-app";

/** Credentials file name. */
const CREDENTIALS_FILE = "credentials.json";

/** Default Auth0 domain (custom domain for production). */
const DEFAULT_AUTH0_DOMAIN = "login.muggle-ai.com";

/** Default Auth0 client ID (Native app with Device Code grant). */
const DEFAULT_AUTH0_CLIENT_ID = "UgG5UjoyLksxMciWWKqVpwfWrJ4rFvtT";

/** Default Auth0 audience. */
const DEFAULT_AUTH0_AUDIENCE = "https://muggleai.us.auth0.com/api/v2/";

/** Default Auth0 scopes. */
const DEFAULT_AUTH0_SCOPE = "openid profile email offline_access";

/** Cached configuration instance. */
let configInstance: IConfig | null = null;

/** Checksums for electron-app binaries by platform. */
interface IMuggleConfigChecksums {
  /** macOS ARM64 (Apple Silicon) checksum. */
  "darwin-arm64"?: string;
  /** macOS x64 (Intel) checksum. */
  "darwin-x64"?: string;
  /** Windows x64 checksum. */
  "win32-x64"?: string;
  /** Linux x64 checksum. */
  "linux-x64"?: string;
}

/** Muggle config from package.json. */
interface IMuggleConfig {
  /** Electron app version. */
  electronAppVersion: string;
  /** Download base URL for electron-app binaries. */
  downloadBaseUrl: string;
  /** SHA256 checksums for each platform binary. */
  checksums?: IMuggleConfigChecksums;
}

/** Cached muggle config from package.json. */
let muggleConfigCache: IMuggleConfig | null = null;

/**
 * Resolve the package root directory from the current module location.
 * @returns The package root directory path.
 */
function getPackageRoot(): string {
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFilePath);

  // Handle both bundled (dist/) and development (src/) contexts
  if (currentDir.endsWith("dist") || currentDir.includes(path.join("dist", "shared"))) {
    // Navigate up from dist/shared to package root
    return path.resolve(currentDir, "..", "..");
  }

  if (currentDir.includes(path.join("src", "shared"))) {
    // Navigate up from src/shared to package root
    return path.resolve(currentDir, "..", "..");
  }

  return path.dirname(currentDir);
}

/**
 * Get the muggle config from package.json.
 * @returns The muggle config with electronAppVersion, downloadBaseUrl, and checksums.
 */
function getMuggleConfig(): IMuggleConfig {
  if (muggleConfigCache) {
    return muggleConfigCache;
  }

  const packageRoot = getPackageRoot();
  const packageJsonPath = path.join(packageRoot, "package.json");

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const config = packageJson.muggleConfig;

    if (config?.electronAppVersion && config?.downloadBaseUrl) {
      muggleConfigCache = {
        electronAppVersion: config.electronAppVersion,
        downloadBaseUrl: config.downloadBaseUrl,
        checksums: config.checksums,
      };
      return muggleConfigCache;
    }
  } catch {
    // Fall through to defaults
  }

  muggleConfigCache = {
    electronAppVersion: "1.0.0",
    downloadBaseUrl: "https://github.com/multiplex-ai/muggle-ai-mcp/releases/download",
    checksums: {},
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
 * Build Auth0 configuration from environment.
 * @returns Auth0 configuration.
 */
function buildAuth0Config(): IAuth0Config {
  return {
    domain: process.env.AUTH0_DOMAIN ?? DEFAULT_AUTH0_DOMAIN,
    clientId: process.env.AUTH0_CLIENT_ID ?? DEFAULT_AUTH0_CLIENT_ID,
    audience: process.env.AUTH0_AUDIENCE ?? DEFAULT_AUTH0_AUDIENCE,
    scope: process.env.AUTH0_SCOPE ?? DEFAULT_AUTH0_SCOPE,
  };
}

/**
 * Build QA Gateway configuration from environment.
 * @returns QA Gateway configuration.
 */
function buildQaConfig(): IQaConfig {
  return {
    promptServiceBaseUrl: process.env.PROMPT_SERVICE_BASE_URL ?? DEFAULT_PROMPT_SERVICE_URL,
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

  return {
    webServiceUrl: process.env.WEB_SERVICE_URL ?? DEFAULT_WEB_SERVICE_URL,
    promptServiceUrl: process.env.PROMPT_SERVICE_BASE_URL ?? DEFAULT_PROMPT_SERVICE_URL,
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
      domain: process.env.AUTH0_DOMAIN ?? DEFAULT_AUTH0_DOMAIN,
      clientId: process.env.AUTH0_CLIENT_ID ?? DEFAULT_AUTH0_CLIENT_ID,
      audience: process.env.AUTH0_AUDIENCE ?? DEFAULT_AUTH0_AUDIENCE,
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

/**
 * Get the effective electron-app version.
 * Checks for version override file first (set by `muggle-mcp upgrade`),
 * then falls back to the version specified in package.json.
 * @returns The electron-app version string.
 */
export function getElectronAppVersion(): string {
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

  return getMuggleConfig().electronAppVersion;
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
