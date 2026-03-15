/**
 * Doctor command - diagnoses installation and configuration issues.
 */

import { existsSync } from "fs";

import {
  getBundledElectronAppVersion,
  getConfig,
  getDataDir,
  getElectronAppVersion,
  isElectronAppInstalled,
} from "../shared/config.js";
import { getAuthStatus, getCredentialsFilePath } from "../shared/credentials.js";
import { getLogger } from "../shared/logger.js";

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
 * Run all diagnostic checks.
 * @returns Array of check results.
 */
function runDiagnostics(): ICheckResult[] {
  const results: ICheckResult[] = [];
  const config = getConfig();

  // Check 1: Data directory exists
  const dataDir = getDataDir();
  results.push({
    name: "Data Directory",
    passed: existsSync(dataDir),
    description: existsSync(dataDir) ? `Found at ${dataDir}` : `Not found at ${dataDir}`,
    suggestion: "Run 'muggle-mcp login' to create the data directory",
  });

  // Check 2: Electron app installed
  const electronInstalled = isElectronAppInstalled();
  const electronVersion = getElectronAppVersion();
  const bundledVersion = getBundledElectronAppVersion();
  const isOverridden = electronVersion !== bundledVersion;

  let electronDescription: string;
  if (electronInstalled) {
    electronDescription = `Installed (v${electronVersion})`;
    if (isOverridden) {
      electronDescription += ` [upgraded from bundled v${bundledVersion}]`;
    }
  } else {
    electronDescription = `Not installed (expected v${electronVersion})`;
  }

  results.push({
    name: "Electron App",
    passed: electronInstalled,
    description: electronDescription,
    suggestion: "Run 'muggle-mcp setup' to download the Electron app",
  });

  // Check 2b: Upgrade available hint
  if (electronInstalled) {
    results.push({
      name: "Electron App Updates",
      passed: true,
      description: "Run 'muggle-mcp upgrade --check' to check for updates",
    });
  }

  // Check 3: Authentication status
  const authStatus = getAuthStatus();
  results.push({
    name: "Authentication",
    passed: authStatus.authenticated,
    description: authStatus.authenticated
      ? `Authenticated as ${authStatus.email || "unknown"}`
      : "Not authenticated",
    suggestion: "Run 'muggle-mcp login' to authenticate",
  });

  // Check 4: API key available
  results.push({
    name: "API Key",
    passed: authStatus.hasApiKey,
    description: authStatus.hasApiKey ? "API key stored" : "No API key stored",
    suggestion: "Run 'muggle-mcp login' to generate an API key",
  });

  // Check 5: Credentials file
  const credentialsPath = getCredentialsFilePath();
  results.push({
    name: "Credentials File",
    passed: existsSync(credentialsPath),
    description: existsSync(credentialsPath)
      ? `Found at ${credentialsPath}`
      : `Not found at ${credentialsPath}`,
    suggestion: "Run 'muggle-mcp login' to create credentials",
  });

  // Check 6: Prompt service URL
  results.push({
    name: "Prompt Service URL",
    passed: !!config.qa.promptServiceBaseUrl,
    description: config.qa.promptServiceBaseUrl,
  });

  // Check 7: Web service URL (for local testing)
  results.push({
    name: "Web Service URL",
    passed: !!config.localQa.webServiceUrl,
    description: config.localQa.webServiceUrl,
  });

  return results;
}

/**
 * Format a check result for display.
 * @param result - Check result.
 * @returns Formatted string.
 */
function formatCheckResult(result: ICheckResult): string {
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
export async function doctorCommand(): Promise<void> {
  console.log("\nMuggle MCP Doctor");
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
