#!/usr/bin/env node
/**
 * Postinstall script for @muggleai/mcp.
 * Downloads the Electron app binary for local testing.
 */

import { createHash } from "crypto";
import { exec } from "child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import { pipeline } from "stream/promises";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

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
    const downloadUrl = `${baseUrl}/electron-app-v${version}/${binaryName}`;

    const appDir = getElectronAppDir();
    const versionDir = join(appDir, version);

    // Check if already downloaded
    if (existsSync(versionDir)) {
      console.log(`Electron app v${version} already installed at ${versionDir}`);
      return;
    }

    console.log(`Downloading Muggle Test Electron app v${version}...`);
    console.log(`URL: ${downloadUrl}`);

    // Create directories
    mkdirSync(versionDir, { recursive: true });

    // Download using fetch
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

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

    console.log(`Electron app installed to ${versionDir}`);
  } catch (error) {
    console.warn("Warning: Failed to download Electron app.");
    console.warn("You can manually download it later using: muggle-mcp setup");
    console.warn(`Error: ${error.message}`);
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

    exec(cmd, (error) => {
      if (error) {
        reject(error);
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
downloadElectronApp().catch(console.error);
