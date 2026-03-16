#!/usr/bin/env node
/**
 * Postinstall script for @muggleai/mcp.
 * Downloads the Electron app binary for local testing.
 */

import { createHash } from "crypto";
import { exec } from "child_process";
import {
  readFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { pipeline } from "stream/promises";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const VERSION_DIRECTORY_NAME_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const CURSOR_SERVER_NAME = "muggle";

/**
 * Get the Cursor MCP config path.
 * @returns {string} Path to ~/.cursor/mcp.json
 */
function getCursorMcpConfigPath() {
  return join(homedir(), ".cursor", "mcp.json");
}

/**
 * Build the default Cursor server configuration for this package.
 * @returns {{command: string, args: string[]}} Server configuration
 */
function buildCursorServerConfig() {
  const localCliPath = join(process.cwd(), "bin", "muggle-mcp.js");
  return {
    command: "node",
    args: [localCliPath, "serve"],
  };
}

/**
 * Read and parse Cursor mcp.json.
 * @param {string} configPath - Path to mcp.json
 * @returns {Record<string, unknown>} Parsed config object
 */
function readCursorConfig(configPath) {
  if (!existsSync(configPath)) {
    return {};
  }

  const rawConfig = readFileSync(configPath, "utf-8");
  const parsedConfig = JSON.parse(rawConfig);

  if (typeof parsedConfig !== "object" || parsedConfig === null || Array.isArray(parsedConfig)) {
    throw new Error(`Invalid JSON structure in ${configPath}: expected an object at root`);
  }

  return parsedConfig;
}

/**
 * Update ~/.cursor/mcp.json with the muggle server entry.
 * Existing server configurations are preserved.
 */
function updateCursorMcpConfig() {
  const configPath = getCursorMcpConfigPath();
  const cursorDir = join(homedir(), ".cursor");

  try {
    const parsedConfig = readCursorConfig(configPath);
    const currentMcpServers = parsedConfig.mcpServers;
    let normalizedMcpServers = {};

    if (currentMcpServers !== undefined) {
      if (typeof currentMcpServers !== "object" || currentMcpServers === null || Array.isArray(currentMcpServers)) {
        throw new Error(`Invalid mcpServers in ${configPath}: expected an object`);
      }
      normalizedMcpServers = currentMcpServers;
    }

    normalizedMcpServers[CURSOR_SERVER_NAME] = buildCursorServerConfig();
    parsedConfig.mcpServers = normalizedMcpServers;

    mkdirSync(cursorDir, { recursive: true });
    const prettyJson = `${JSON.stringify(parsedConfig, null, 2)}\n`;
    writeFileSync(configPath, prettyJson, "utf-8");
    console.log(`Updated Cursor MCP config: ${configPath}`);
  } catch (error) {
    console.error("\n========================================");
    console.error("ERROR: Failed to update Cursor MCP config");
    console.error("========================================\n");
    console.error("Path:", configPath);
    console.error("\nFull error details:");
    console.error(error instanceof Error ? error.stack || error : error);
    console.error("");
  }
}

/**
 * Get the Muggle AI data directory.
 * @returns {string} Path to ~/.muggle-ai
 */
function getDataDir() {
  return join(homedir(), ".muggle-ai");
}

/**
 * Get the Electron app directory.
 * @returns {string} Path to ~/.muggle-ai/electron-app
 */
function getElectronAppDir() {
  return join(getDataDir(), "electron-app");
}

/**
 * Get platform key for checksum lookup.
 * @returns {string} Platform key (e.g., "darwin-arm64", "win32-x64")
 */
function getPlatformKey() {
  const os = platform();
  const arch = process.arch;

  switch (os) {
    case "darwin":
      return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
    case "win32":
      return "win32-x64";
    case "linux":
      return "linux-x64";
    default:
      throw new Error(`Unsupported platform: ${os}`);
  }
}

/**
 * Check whether a directory name looks like a version folder.
 * @param {string} directoryName - Directory name to validate
 * @returns {boolean} True when the directory name is a version
 */
function isVersionDirectoryName(directoryName) {
  return VERSION_DIRECTORY_NAME_PATTERN.test(directoryName);
}

/**
 * Calculate SHA256 checksum of a file.
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} SHA256 checksum as hex string
 */
async function calculateFileChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (data) => {
      hash.update(data);
    });

    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });

    stream.on("error", (error) => {
      reject(error);
    });
  });
}

/**
 * Verify file checksum against expected value.
 * @param {string} filePath - Path to the file
 * @param {string} expectedChecksum - Expected SHA256 checksum
 * @returns {Promise<{valid: boolean, actual: string}>} Verification result
 */
async function verifyFileChecksum(filePath, expectedChecksum) {
  if (!expectedChecksum || expectedChecksum.trim() === "") {
    return { valid: true, actual: "", skipped: true };
  }

  const actualChecksum = await calculateFileChecksum(filePath);
  const normalizedExpected = expectedChecksum.toLowerCase().trim();
  const normalizedActual = actualChecksum.toLowerCase();

  return {
    valid: normalizedExpected === normalizedActual,
    expected: normalizedExpected,
    actual: normalizedActual,
    skipped: false,
  };
}

/**
 * Remove Electron app version directories that do not match the current version.
 * @param {object} params - Cleanup parameters
 * @param {string} params.appDir - Base Electron app directory
 * @param {string} params.currentVersion - Version that should be kept
 */
function cleanupNonCurrentVersions({ appDir, currentVersion }) {
  if (!existsSync(appDir)) {
    return;
  }

  const appEntries = readdirSync(appDir, { withFileTypes: true });

  for (const appEntry of appEntries) {
    if (!appEntry.isDirectory()) {
      continue;
    }

    if (!isVersionDirectoryName(appEntry.name)) {
      continue;
    }

    if (appEntry.name === currentVersion) {
      continue;
    }

    const staleVersionDir = join(appDir, appEntry.name);
    try {
      console.log(`Removing stale Electron app version: ${appEntry.name}`);
      rmSync(staleVersionDir, { recursive: true, force: true });
    } catch (error) {
      console.error("\n========================================");
      console.error("ERROR: Failed to remove stale Electron app version");
      console.error("========================================\n");
      console.error("Version:", appEntry.name);
      console.error("Path:", staleVersionDir);
      console.error("\nFull error details:");
      console.error(error instanceof Error ? error.stack || error : error);
      console.error("");
    }
  }
}

/**
 * Get platform-specific binary name.
 * @returns {string} Binary filename
 */
function getBinaryName() {
  const os = platform();
  const arch = process.arch;

  switch (os) {
    case "darwin":
      // Support both Apple Silicon (arm64) and Intel (x64) Macs
      return arch === "arm64"
        ? "MuggleAI-darwin-arm64.zip"
        : "MuggleAI-darwin-x64.zip";
    case "win32":
      return "MuggleAI-win32-x64.zip";
    case "linux":
      return "MuggleAI-linux-x64.zip";
    default:
      throw new Error(`Unsupported platform: ${os}`);
  }
}

/**
 * Get the expected extracted executable path for the current platform.
 * @param {string} versionDir - Version directory path
 * @returns {string} Expected executable path
 */
function getExpectedExecutablePath(versionDir) {
  const os = platform();

  switch (os) {
    case "darwin":
      return join(versionDir, "MuggleAI.app", "Contents", "MacOS", "MuggleAI");
    case "win32":
      return join(versionDir, "MuggleAI.exe");
    case "linux":
      return join(versionDir, "MuggleAI");
    default:
      throw new Error(`Unsupported platform: ${os}`);
  }
}

/**
 * Download and extract the Electron app.
 */
async function downloadElectronApp() {
  try {
    // Read config from package.json
    const packageJson = require("../package.json");
    const config = packageJson.muggleConfig || {};
    const version = config.electronAppVersion || "1.0.0";
    const baseUrl = config.downloadBaseUrl || "https://github.com/multiplex-ai/muggle-ai-mcp/releases/download";

    const binaryName = getBinaryName();
    const downloadUrl = `${baseUrl}/v${version}/${binaryName}`;

    const appDir = getElectronAppDir();
    const versionDir = join(appDir, version);

    // Check if already downloaded and extracted correctly
    const expectedExecutablePath = getExpectedExecutablePath(versionDir);
    if (existsSync(versionDir)) {
      if (existsSync(expectedExecutablePath)) {
        cleanupNonCurrentVersions({ appDir: appDir, currentVersion: version });
        console.log(`Electron app v${version} already installed at ${versionDir}`);
        return;
      }

      console.log(
        `Electron app v${version} directory exists but executable is missing. Re-downloading...`,
      );
      rmSync(versionDir, { recursive: true, force: true });
    }

    console.log(`Downloading Muggle Test Electron app v${version}...`);
    console.log(`URL: ${downloadUrl}`);

    // Create directories
    mkdirSync(versionDir, { recursive: true });

    // Download using fetch
    console.log("Fetching...");
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Download failed: ${response.status} ${response.statusText}\n` +
        `URL: ${downloadUrl}\n` +
        `Response body: ${errorBody.substring(0, 500)}`
      );
    }
    console.log(`Response OK (${response.status}), downloading ${response.headers.get("content-length") || "unknown"} bytes...`);

    const tempFile = join(versionDir, binaryName);
    const fileStream = createWriteStream(tempFile);
    await pipeline(response.body, fileStream);

    console.log("Download complete, verifying checksum...");

    // Get expected checksum from config
    const checksums = config.checksums || {};
    const platformKey = getPlatformKey();
    const expectedChecksum = checksums[platformKey] || "";

    // Verify checksum
    const checksumResult = await verifyFileChecksum(tempFile, expectedChecksum);

    if (!checksumResult.valid && !checksumResult.skipped) {
      rmSync(versionDir, { recursive: true, force: true });
      throw new Error(
        `Checksum verification failed!\n` +
        `Expected: ${checksumResult.expected}\n` +
        `Actual:   ${checksumResult.actual}\n` +
        `The downloaded file may be corrupted or tampered with.`
      );
    }

    if (checksumResult.skipped) {
      console.log("Warning: No checksum configured, skipping verification.");
    } else {
      console.log("Checksum verified successfully.");
    }

    console.log("Extracting...");

    // Extract based on file type
    if (binaryName.endsWith(".zip")) {
      await extractZip(tempFile, versionDir);
    } else if (binaryName.endsWith(".tar.gz")) {
      await extractTarGz(tempFile, versionDir);
    }

    // Clean up temp file
    rmSync(tempFile, { force: true });

    cleanupNonCurrentVersions({ appDir: appDir, currentVersion: version });

    console.log(`Electron app installed to ${versionDir}`);
  } catch (error) {
    console.error("\n========================================");
    console.error("ERROR: Failed to download Electron app");
    console.error("========================================\n");
    console.error("Error message:", error.message);
    console.error("\nFull error details:");
    console.error(error.stack || error);
    console.error("\nDebug info:");
    console.error("  - Platform:", platform());
    console.error("  - Architecture:", process.arch);
    console.error("  - Node version:", process.version);
    try {
      const packageJson = require("../package.json");
      const config = packageJson.muggleConfig || {};
      console.error("  - Electron app version:", config.electronAppVersion || "unknown");
      console.error("  - Download URL:", `${config.downloadBaseUrl}/v${config.electronAppVersion}/${getBinaryName()}`);
    } catch {
      console.error("  - Could not read package.json config");
    }
    console.error("\nYou can manually download it later using: muggle-mcp setup");
    console.error("Or set ELECTRON_APP_PATH to point to an existing installation.\n");
  }
}

/**
 * Extract a zip file.
 * @param {string} zipPath - Path to zip file
 * @param {string} destDir - Destination directory
 */
async function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const cmd = platform() === "win32"
      ? `powershell -command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`
      : `unzip -o "${zipPath}" -d "${destDir}"`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error("Extraction command failed:", cmd);
        console.error("stdout:", stdout);
        console.error("stderr:", stderr);
        reject(new Error(`Extraction failed: ${error.message}\nstderr: ${stderr}`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Extract a tar.gz file.
 * @param {string} tarPath - Path to tar.gz file
 * @param {string} destDir - Destination directory
 */
async function extractTarGz(tarPath, destDir) {
  return new Promise((resolve, reject) => {
    exec(`tar -xzf "${tarPath}" -C "${destDir}"`, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

// Run postinstall
updateCursorMcpConfig();
downloadElectronApp().catch(console.error);
