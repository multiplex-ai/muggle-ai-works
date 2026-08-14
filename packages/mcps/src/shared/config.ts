/**
 * Configuration management for @muggleai/works.
 * Unified configuration for both cloud E2E acceptance gateway and local E2E acceptance execution.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

import { getDataDir as getSharedDataDir } from "./data-dir.js";
import { readReleaseManifest } from "./release_manifest.js";
import { DEFAULT_AUTH0_SCOPE, DEFAULT_WEB_SERVICE_URL } from "./runtime-target-constants.js";
import {
  resolveActiveProfile,
  resolveActiveReleaseStream,
  resolveActiveReleaseTagPrefix,
  resolveRuntimeTarget,
} from "./runtime-target.js";
import {
  ElectronAppReleaseStream,
  RuntimeTarget,
  type IRuntimeTargetProfile,
} from "./runtime-target-types.js";
import type {
  IAuth0Config,
  IConfig,
  ILocalQaConfig,
  IMuggleConfig,
  IMuggleConfigChecksums,
  IE2eConfig,
} from "./types.js";

/** Subdirectory for downloaded electron-app binaries. */
const ELECTRON_APP_DIR = "electron-app";

/** API key storage file name. */
const API_KEY_FILE = "api-key.json";

/** Cached configuration instance. */
let configInstance: IConfig | null = null;

/** Cached muggle config from package.json. */
let muggleConfigCache: IMuggleConfig | null = null;

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
    // packages/mcps/src/shared -> repository root (4 levels). The nested
    // packages/mcps/package.json carries no muggleConfig, so stopping short
    // makes every config read fail outside a bundled build.
    return path.resolve(currentDir, "..", "..", "..", "..");
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
        `  This is a bug - please report it.`,
      { cause: error },
    );
  }

  const config = packageJson.muggleConfig as Record<string, unknown> | undefined;

  if (!config) {
    throw new Error(
      `Missing muggleConfig in package.json.\n` +
        `  Path: ${packageJsonPath}\n` +
        `  This is a bug - please report it.`,
    );
  }

  if (!config.electronAppVersion || typeof config.electronAppVersion !== "string") {
    throw new Error(
      `Missing or invalid muggleConfig.electronAppVersion in package.json.\n` +
        `  Path: ${packageJsonPath}\n` +
        `  Value: ${JSON.stringify(config.electronAppVersion)}\n` +
        `  This is a bug - please report it.`,
    );
  }

  if (!config.downloadBaseUrl || typeof config.downloadBaseUrl !== "string") {
    throw new Error(
      `Missing or invalid muggleConfig.downloadBaseUrl in package.json.\n` +
        `  Path: ${packageJsonPath}\n` +
        `  Value: ${JSON.stringify(config.downloadBaseUrl)}\n` +
        `  This is a bug - please report it.`,
    );
  }

  const runtimeTargetDefault = config.runtimeTargetDefault as RuntimeTarget | undefined;

  if (
    runtimeTargetDefault !== undefined &&
    !Object.values(RuntimeTarget).includes(runtimeTargetDefault)
  ) {
    throw new Error(
      `Invalid muggleConfig.runtimeTargetDefault in package.json.\n` +
        `  Path: ${packageJsonPath}\n` +
        `  Value: ${JSON.stringify(config.runtimeTargetDefault)}\n` +
        `  Expected one of: ${Object.values(RuntimeTarget).join(", ")}\n` +
        `  This is a bug - please report it.`,
    );
  }

  muggleConfigCache = {
    electronAppVersion: config.electronAppVersion,
    downloadBaseUrl: config.downloadBaseUrl,
    checksumsByStream:
      (config.checksumsByStream as IMuggleConfig["checksumsByStream"]) || {},
    runtimeTargetDefault: runtimeTargetDefault,
  };

  return muggleConfigCache;
}

/**
 * Get the Muggle AI data directory path.
 * @returns Path to ~/.muggle-ai
 */
export function getDataDir(): string {
  return getSharedDataDir();
}

/**
 * Get the path to the downloaded electron-app binary for the current platform.
 * Uses the effective version (env -> override -> bundled) to match where
 * setup/upgrade actually installs the binary.
 * @returns The path to the downloaded binary, or null if not found.
 */
function getDownloadedElectronAppPath(): string | null {
  const platformName = os.platform();
  const version = getElectronAppVersion();

  const baseDir = path.join(getDataDir(), ELECTRON_APP_DIR, version);

  let binaryPath: string;

  switch (platformName) {
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
  const platformName = os.platform();
  const homeDir = os.homedir();

  let binaryPath: string;

  switch (platformName) {
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
 *
 * Resolves from the filesystem on every call — no caching. Long-running MCP
 * servers must pick up `muggle upgrade` / `muggle setup` changes without
 * needing a process restart.
 * @returns The path to the electron-app executable, or null when not installed.
 */
export function resolveElectronAppPathOrNull(): string | null {
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
 * Get the runtime target this harness build is pointing at.
 * @returns The active runtime target.
 */
export function getActiveRuntimeTarget(): RuntimeTarget {
  return resolveRuntimeTarget(getMuggleConfig().runtimeTargetDefault);
}

/**
 * Get the configuration profile for the active runtime target.
 * @returns The active target's profile.
 */
function getActiveProfile(): IRuntimeTargetProfile {
  return resolveActiveProfile(getMuggleConfig().runtimeTargetDefault);
}

/**
 * Build Auth0 configuration from environment.
 * @returns Auth0 configuration.
 */
function buildAuth0Config(): IAuth0Config {
  const activeProfile = getActiveProfile();

  return {
    domain: process.env.AUTH0_DOMAIN ?? activeProfile.auth0Domain,
    clientId: process.env.AUTH0_CLIENT_ID ?? activeProfile.auth0ClientId,
    audience: process.env.AUTH0_AUDIENCE ?? activeProfile.auth0Audience,
    scope: process.env.AUTH0_SCOPE ?? DEFAULT_AUTH0_SCOPE,
  };
}

/**
 * Build cloud E2E acceptance gateway configuration from environment.
 * @returns Cloud E2E acceptance gateway configuration.
 */
function buildE2eConfig(): IE2eConfig {
  return {
    promptServiceBaseUrl:
      process.env.PROMPT_SERVICE_BASE_URL ?? getActiveProfile().promptServiceBaseUrl,
    requestTimeoutMs: parseInteger(process.env.REQUEST_TIMEOUT_MS, 30000),
    workflowTimeoutMs: parseInteger(process.env.WORKFLOW_TIMEOUT_MS, 120000),
  };
}

/**
 * Build local E2E acceptance execution configuration from environment.
 * @returns Local E2E acceptance execution configuration.
 */
function buildLocalQaConfig(): ILocalQaConfig {
  const dataDir = getDataDir();
  const auth0Scopes = (process.env.AUTH0_SCOPE ?? DEFAULT_AUTH0_SCOPE).split(" ");
  const activeProfile = getActiveProfile();

  return {
    webServiceUrl: process.env.WEB_SERVICE_URL ?? DEFAULT_WEB_SERVICE_URL,
    promptServiceUrl: process.env.PROMPT_SERVICE_BASE_URL ?? activeProfile.promptServiceBaseUrl,
    dataDir: dataDir,
    sessionsDir: path.join(dataDir, "sessions"),
    projectsDir: path.join(dataDir, "projects"),
    tempDir: path.join(dataDir, "temp"),
    apiKeyFilePath: path.join(dataDir, API_KEY_FILE),
    oauthSessionFilePath: path.join(dataDir, "oauth-session.json"),
    webServicePath: resolveWebServicePath(),
    webServicePidFile: path.join(dataDir, "web-service.pid"),
    auth0: {
      domain: process.env.AUTH0_DOMAIN ?? activeProfile.auth0Domain,
      clientId: process.env.AUTH0_CLIENT_ID ?? activeProfile.auth0ClientId,
      audience: process.env.AUTH0_AUDIENCE ?? activeProfile.auth0Audience,
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

  // serverVersion was previously hardcoded to "1.0.0", which drifted from
  // the root @muggleai/works package.json version. Sourcing from the release
  // manifest keeps both in sync and removes the need to remember to bump it.
  const manifest = readReleaseManifest();

  configInstance = {
    serverName: "muggle",
    serverVersion: manifest.release,
    logLevel: process.env.LOG_LEVEL ?? "info",
    auth0: buildAuth0Config(),
    e2e: buildE2eConfig(),
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
 * 2. Override file (set by `muggle upgrade`)
 * 3. package.json muggleConfig.electronAppVersion (bundled default)
 * @returns The electron-app version string.
 */
export function getElectronAppVersion(): string {
  // Check environment variable first (highest priority)
  const envVersion = process.env[ELECTRON_APP_VERSION_ENV];
  if (envVersion && /^\d+\.\d+\.\d+$/.test(envVersion)) {
    return envVersion;
  }

  // Check override file (set by muggle upgrade)
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
 * Get the electron-app release stream the active runtime target installs from.
 * @returns The active release stream.
 */
export function getActiveElectronAppReleaseStream(): ElectronAppReleaseStream {
  return resolveActiveReleaseStream(getMuggleConfig().runtimeTargetDefault);
}

/**
 * Get the electron-app release tag prefix for the active runtime target.
 * @returns Release tag prefix (for example, "electron-app-v").
 */
export function getElectronAppReleaseTagPrefix(): string {
  return resolveActiveReleaseTagPrefix(getMuggleConfig().runtimeTargetDefault);
}

/**
 * Build electron-app release tag from a version string.
 * @param version - Version string (for example, "1.0.28").
 * @returns Release tag (for example, "electron-app-v1.0.28").
 */
export function buildElectronAppReleaseTag(version: string): string {
  return `${getElectronAppReleaseTagPrefix()}${version}`;
}

/**
 * Build a release asset URL for a specific electron-app version.
 * @param params - Build parameters.
 * @param params.version - Electron app version.
 * @param params.assetFileName - Release asset file name.
 * @returns Fully-qualified download URL.
 */
export function buildElectronAppReleaseAssetUrl(params: {
  version: string;
  assetFileName: string;
}): string {
  return `${getDownloadBaseUrl()}/${buildElectronAppReleaseTag(params.version)}/${params.assetFileName}`;
}

/**
 * Build checksums.txt URL for a specific electron-app release version.
 * @param version - Electron app version.
 * @returns Fully-qualified checksums URL.
 */
export function buildElectronAppChecksumsUrl(version: string): string {
  return `${getDownloadBaseUrl()}/${buildElectronAppReleaseTag(version)}/checksums.txt`;
}

/**
 * Get the checksums for the active electron-app release stream.
 *
 * Keyed by stream rather than by runtime target because dev and production
 * install the same studio binary; keying by target would leave dev with no
 * recorded hashes and silently skip verification.
 * @returns Checksums map by platform, or undefined when the stream records none.
 */
export function getElectronAppChecksums(): IMuggleConfigChecksums | undefined {
  return getMuggleConfig().checksumsByStream?.[getActiveElectronAppReleaseStream()];
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
  const resolvedVersion = version ?? getElectronAppVersion();
  return path.join(getDataDir(), ELECTRON_APP_DIR, resolvedVersion);
}
