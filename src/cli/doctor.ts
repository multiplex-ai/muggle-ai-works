/**
 * Doctor command - diagnoses installation and configuration issues.
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import {
  getAuthService,
  getBundledElectronAppVersion,
  getConfig,
  getCredentialsFilePath,
  getDataDir,
  getElectronAppDir,
  getElectronAppVersion,
  getElectronAppVersionSource,
  getLogger,
  hasApiKey,
} from "../../packages/mcps/src/index.js";
import * as fs from "fs";
import { platform } from "os";
import * as path from "path";

const logger = getLogger();

/**
 * Check result with status indicator.
 */
interface ICheckResult {
  /** Check name. */
  name: string;
  /** Whether check passed. */
  passed: boolean;
  /** Description of the result. */
  description: string;
  /** Suggestion to fix (if failed). */
  suggestion?: string;
}

/**
 * Cursor MCP server configuration.
 */
interface ICursorMcpServerConfig {
  /**
   * Command executable.
   */
  command: string;
  /**
   * Command arguments.
   */
  args?: string[];
}

/**
 * Root Cursor MCP config shape.
 */
interface ICursorMcpConfig {
  /**
   * MCP server map.
   */
  mcpServers?: Record<string, ICursorMcpServerConfig>;
}

/**
 * Resolve the Cursor MCP config path.
 *
 * @returns Absolute path to the config file.
 */
function getCursorMcpConfigPath (): string {
  return join(homedir(), ".cursor", "mcp.json");
}

/**
 * Get the expected executable path for the current platform.
 * @param versionDir - Version directory path.
 * @returns Path to the expected executable.
 */
function getExpectedExecutablePath(versionDir: string): string {
  const os = platform();

  switch (os) {
    case "darwin":
      return path.join(versionDir, "MuggleAI.app", "Contents", "MacOS", "MuggleAI");
    case "win32":
      return path.join(versionDir, "MuggleAI.exe");
    case "linux":
      return path.join(versionDir, "MuggleAI");
    default:
      throw new Error(`Unsupported platform: ${os}`);
  }
}

/**
 * Detailed installation verification result.
 */
interface IInstallVerification {
  /** Whether the installation is valid. */
  valid: boolean;
  /** Version directory path. */
  versionDir: string;
  /** Expected executable path. */
  executablePath: string;
  /** Whether the executable exists. */
  executableExists: boolean;
  /** Whether the executable is a file (not symlink to missing target). */
  executableIsFile: boolean;
  /** Whether metadata file exists. */
  metadataExists: boolean;
  /** Whether partial archive exists (incomplete install). */
  hasPartialArchive: boolean;
  /** Detailed error message if invalid. */
  errorDetail?: string;
}

/**
 * Verify electron app installation in detail.
 * @returns Verification result.
 */
function verifyElectronAppInstallation(): IInstallVerification {
  const version = getElectronAppVersion();
  const versionDir = getElectronAppDir(version);
  const executablePath = getExpectedExecutablePath(versionDir);
  const metadataPath = path.join(versionDir, ".install-metadata.json");

  const result: IInstallVerification = {
    valid: false,
    versionDir: versionDir,
    executablePath: executablePath,
    executableExists: false,
    executableIsFile: false,
    metadataExists: false,
    hasPartialArchive: false,
  };

  // Check if version directory exists
  if (!fs.existsSync(versionDir)) {
    result.errorDetail = "Version directory does not exist";
    return result;
  }

  // Check for partial archive (incomplete download)
  const archivePatterns = ["MuggleAI-darwin", "MuggleAI-win32", "MuggleAI-linux"];
  try {
    const files = fs.readdirSync(versionDir);
    for (const file of files) {
      if (archivePatterns.some((pattern) => file.startsWith(pattern)) && (file.endsWith(".zip") || file.endsWith(".tar.gz"))) {
        result.hasPartialArchive = true;
        break;
      }
    }
  } catch {
    // Ignore read errors
  }

  // Check if executable exists
  result.executableExists = fs.existsSync(executablePath);

  if (!result.executableExists) {
    if (result.hasPartialArchive) {
      result.errorDetail = "Download incomplete: archive found but not extracted";
    } else {
      result.errorDetail = "Executable not found at expected path";
    }
    return result;
  }

  // Check if executable is a real file (handles broken symlinks)
  try {
    const stats = fs.statSync(executablePath);
    result.executableIsFile = stats.isFile();
    if (!result.executableIsFile) {
      result.errorDetail = "Executable path exists but is not a file";
      return result;
    }
  } catch {
    result.errorDetail = "Cannot stat executable (broken symlink?)";
    return result;
  }

  // Check metadata file
  result.metadataExists = fs.existsSync(metadataPath);

  // All checks passed
  result.valid = true;
  return result;
}

/**
 * Validate muggle server entry in Cursor MCP config.
 *
 * @returns Validation status and description.
 */
function validateCursorMcpConfig(): { passed: boolean; description: string } {
  const cursorMcpConfigPath = getCursorMcpConfigPath();

  if (!existsSync(cursorMcpConfigPath)) {
    return {
      passed: false,
      description: `Missing at ${cursorMcpConfigPath}`,
    };
  }

  try {
    const rawCursorConfig = JSON.parse(
      readFileSync(cursorMcpConfigPath, "utf-8"),
    ) as ICursorMcpConfig;

    if (!rawCursorConfig.mcpServers) {
      return {
        passed: false,
        description: "Missing mcpServers key",
      };
    }

    const muggleServerConfig = rawCursorConfig.mcpServers.muggle;
    if (!muggleServerConfig) {
      return {
        passed: false,
        description: "Missing mcpServers.muggle entry",
      };
    }

    if (!Array.isArray(muggleServerConfig.args)) {
      return {
        passed: false,
        description: "mcpServers.muggle.args is not an array",
      };
    }

    const hasServeArgument = muggleServerConfig.args.includes("serve");
    if (!hasServeArgument) {
      return {
        passed: false,
        description: "mcpServers.muggle args does not include 'serve'",
      };
    }

    if (muggleServerConfig.command === "node") {
      const firstArgument = muggleServerConfig.args.at(0);
      if (!firstArgument) {
        return {
          passed: false,
          description: "mcpServers.muggle command is node but args[0] is missing",
        };
      }

      if (!existsSync(firstArgument)) {
        return {
          passed: false,
          description: `mcpServers.muggle args[0] does not exist: ${firstArgument}`,
        };
      }
    }

    return {
      passed: true,
      description: `Configured at ${cursorMcpConfigPath}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      passed: false,
      description: `Invalid JSON or schema: ${errorMessage}`,
    };
  }
}

/**
 * Run all diagnostic checks.
 * @returns Array of check results.
 */
function runDiagnostics (): ICheckResult[] {
  const results: ICheckResult[] = [];
  const config = getConfig();

  // Check 1: Data directory exists
  const dataDir = getDataDir();
  results.push({
    name: "Data Directory",
    passed: existsSync(dataDir),
    description: existsSync(dataDir) ? `Found at ${dataDir}` : `Not found at ${dataDir}`,
    suggestion: "Run 'muggle login' to create the data directory",
  });

  // Check 2: Electron app installed (with detailed verification)
  const electronVersion = getElectronAppVersion();
  const bundledVersion = getBundledElectronAppVersion();
  const versionSource = getElectronAppVersionSource();
  const installVerification = verifyElectronAppInstallation();

  let electronDescription: string;
  let electronSuggestion: string | undefined;

  if (installVerification.valid) {
    electronDescription = `Installed (v${electronVersion})`;
    switch (versionSource) {
      case "env":
        electronDescription += ` [from ELECTRON_APP_VERSION env]`;
        break;
      case "override":
        electronDescription += ` [overridden from bundled v${bundledVersion}]`;
        break;
      default:
        break;
    }

    if (!installVerification.metadataExists) {
      electronDescription += " [missing metadata]";
    }
  } else {
    electronDescription = `Not installed (expected v${electronVersion})`;

    if (installVerification.errorDetail) {
      electronDescription += `\n  └─ ${installVerification.errorDetail}`;
      electronDescription += `\n  └─ Checked: ${installVerification.versionDir}`;
    }

    if (installVerification.hasPartialArchive) {
      electronSuggestion = "Run 'muggle setup --force' to re-download and extract";
    } else {
      electronSuggestion = "Run 'muggle setup' to download the Electron app";
    }
  }

  results.push({
    name: "Electron App",
    passed: installVerification.valid,
    description: electronDescription,
    suggestion: electronSuggestion,
  });

  // Check 2b: Upgrade available hint
  if (installVerification.valid) {
    results.push({
      name: "Electron App Updates",
      passed: true,
      description: "Run 'muggle upgrade --check' to check for updates",
    });
  }

  // Check 3: Authentication status
  const authService = getAuthService();
  const authStatus = authService.getAuthStatus();
  results.push({
    name: "Authentication",
    passed: authStatus.authenticated,
    description: authStatus.authenticated
      ? `Authenticated as ${authStatus.email ?? "unknown"}`
      : "Not authenticated",
    suggestion: "Run 'muggle login' to authenticate",
  });

  // Check 4: API key available
  const hasStoredApiKey = hasApiKey();
  results.push({
    name: "API Key",
    passed: hasStoredApiKey,
    description: hasStoredApiKey ? "API key stored" : "No API key stored (optional)",
    suggestion: "Run 'muggle login --key-name <name>' to generate an API key",
  });

  // Check 5: Credentials file
  const credentialsPath = getCredentialsFilePath();
  results.push({
    name: "Credentials File",
    passed: existsSync(credentialsPath),
    description: existsSync(credentialsPath) ? `Found at ${credentialsPath}` : `Not found at ${credentialsPath}`,
    suggestion: "Run 'muggle login' to create credentials",
  });

  // Check 6: Prompt service URL
  results.push({
    name: "Prompt Service URL",
    passed: !!config.e2e.promptServiceBaseUrl,
    description: config.e2e.promptServiceBaseUrl,
  });

  // Check 7: Web service URL (for local testing)
  results.push({
    name: "Web Service URL",
    passed: !!config.localQa.webServiceUrl,
    description: config.localQa.webServiceUrl,
  });

  // Check 8: Cursor MCP configuration contract from postinstall
  const cursorMcpConfigValidationResult = validateCursorMcpConfig();
  results.push({
    name: "Cursor MCP Config",
    passed: cursorMcpConfigValidationResult.passed,
    description: cursorMcpConfigValidationResult.description,
    suggestion: "Re-run npm install -g @muggleai/works to refresh ~/.cursor/mcp.json",
  });

  return results;
}

/**
 * Format a check result for display.
 * @param result - Check result.
 * @returns Formatted string.
 */
function formatCheckResult (result: ICheckResult): string {
  const icon = result.passed ? "✓" : "✗";
  const color = result.passed ? "\x1b[32m" : "\x1b[31m"; // Green or Red
  const reset = "\x1b[0m";

  let output = `${color}${icon}${reset} ${result.name}: ${result.description}`;

  if (!result.passed && result.suggestion) {
    output += `\n  └─ ${result.suggestion}`;
  }

  return output;
}

/**
 * Execute the doctor command.
 */
export async function doctorCommand (): Promise<void> {
  console.log("\nMuggle Works Doctor");
  console.log("=================\n");

  const results = runDiagnostics();

  for (const result of results) {
    console.log(formatCheckResult(result));
  }

  console.log("");

  const failedCount = results.filter((r) => !r.passed).length;

  if (failedCount === 0) {
    console.log("All checks passed! Your installation is ready.");
  } else {
    console.log(`${failedCount} issue(s) found. See suggestions above.`);
  }

  logger.info("Doctor command completed", {
    totalChecks: results.length,
    passed: results.length - failedCount,
    failed: failedCount,
  });
}


