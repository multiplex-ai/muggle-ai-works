#!/usr/bin/env node
/**
 * Postinstall script for @muggleai/mcp.
 * Downloads the Electron app binary for local testing.
 */

import { exec } from "child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "fs";
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
 * Get platform-specific binary name.
 * @returns {string} Binary filename
 */
function getBinaryName() {
  const os = platform();
  switch (os) {
    case "darwin":
      return "muggle-test-darwin-arm64.zip";
    case "win32":
      return "muggle-test-win32-x64.zip";
    case "linux":
      return "muggle-test-linux-x64.tar.gz";
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

    console.log("Download complete, extracting...");

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
