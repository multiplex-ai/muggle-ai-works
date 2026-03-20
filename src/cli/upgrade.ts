/**
 * Upgrade command - checks for and downloads the latest electron-app version.
 * Allows users to get newer electron-app versions independently of MCP updates.
 */

import { exec } from "child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { platform } from "os";
import * as path from "path";
import { pipeline } from "stream/promises";

import {
  getDataDir,
  getDownloadBaseUrl,
  getElectronAppDir,
  getElectronAppVersion,
  getLogger,
  getPlatformKey,
  verifyFileChecksum,
} from "@muggleai/mcp";
import { cleanupOldVersions, formatBytes } from "./cleanup.js";

const logger = getLogger();

/** GitHub API URL for releases. */
const GITHUB_RELEASES_API = "https://api.github.com/repos/multiplex-ai/muggle-ai-works/releases";

/** Filename for storing the overridden electron-app version. */
const VERSION_OVERRIDE_FILE = "electron-app-version-override.json";

/**
 * Options for the upgrade command.
 */
export interface IUpgradeOptions {
  /** Force re-download even if already on latest. */
  force?: boolean;
  /** Check for updates only, don't download. */
  check?: boolean;
  /** Specific version to download (e.g., "1.0.2"). */
  version?: string;
}

/**
 * Result of checking for updates.
 */
interface IUpdateCheckResult {
  /** Currently installed version. */
  currentVersion: string;
  /** Latest available version. */
  latestVersion: string;
  /** Whether an update is available. */
  updateAvailable: boolean;
  /** Download URL for the latest version. */
  downloadUrl?: string;
}

/**
 * Get platform-specific binary name.
 * @returns Binary filename.
 */
function getBinaryName(): string {
  const os = platform();
  const arch = process.arch;

  switch (os) {
    case "darwin":
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
 * Extract version from release tag.
 * @param tag - Release tag (e.g., "electron-app-v1.0.2").
 * @returns Version string (e.g., "1.0.2") or null.
 */
function extractVersionFromTag(tag: string): string | null {
  const match = tag.match(/^electron-app-v(\d+\.\d+\.\d+)$/);
  return match ? match[1] : null;
}

/**
 * Get the path to the version override file.
 * @returns Path to the override file.
 */
function getVersionOverridePath(): string {
  return path.join(getDataDir(), VERSION_OVERRIDE_FILE);
}

/**
 * Get the effective electron-app version (override or default).
 * @returns The version to use.
 */
export function getEffectiveElectronAppVersion(): string {
  const overridePath = getVersionOverridePath();

  if (existsSync(overridePath)) {
    try {
      const content = JSON.parse(require("fs").readFileSync(overridePath, "utf-8"));
      if (content.version) {
        return content.version;
      }
    } catch {
      // Fall through to default
    }
  }

  return getElectronAppVersion();
}

/**
 * Save the version override.
 * @param version - Version to save.
 */
function saveVersionOverride(version: string): void {
  const overridePath = getVersionOverridePath();
  const dataDir = getDataDir();

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  writeFileSync(overridePath, JSON.stringify({
    version: version,
    updatedAt: new Date().toISOString(),
  }, null, 2), "utf-8");
}

/**
 * Check for the latest electron-app version from GitHub releases.
 * @returns Update check result.
 */
async function checkForUpdates(): Promise<IUpdateCheckResult> {
  const currentVersion = getEffectiveElectronAppVersion();

  try {
    const response = await fetch(GITHUB_RELEASES_API, {
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "muggle",
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const releases = await response.json() as Array<{
      tag_name: string;
      prerelease: boolean;
      draft: boolean;
    }>;

    // Find latest electron-app release (non-prerelease, non-draft)
    for (const release of releases) {
      if (release.prerelease || release.draft) {
        continue;
      }

      const version = extractVersionFromTag(release.tag_name);
      if (version) {
        const updateAvailable = compareVersions(version, currentVersion) > 0;
        const baseUrl = getDownloadBaseUrl();
        const binaryName = getBinaryName();

        return {
          currentVersion: currentVersion,
          latestVersion: version,
          updateAvailable: updateAvailable,
          downloadUrl: `${baseUrl}/electron-app-v${version}/${binaryName}`,
        };
      }
    }

    // No electron-app releases found
    return {
      currentVersion: currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to check for updates", { error: errorMessage });
    throw new Error(`Failed to check for updates: ${errorMessage}`);
  }
}

/**
 * Compare two semver versions.
 * @param a - First version.
 * @param b - Second version.
 * @returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const partA = partsA[i] || 0;
    const partB = partsB[i] || 0;

    if (partA > partB) {
      return 1;
    }
    if (partA < partB) {
      return -1;
    }
  }

  return 0;
}

/**
 * Extract a zip file.
 * @param zipPath - Path to zip file.
 * @param destDir - Destination directory.
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd =
      platform() === "win32"
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
 * @param tarPath - Path to tar.gz file.
 * @param destDir - Destination directory.
 */
async function extractTarGz(tarPath: string, destDir: string): Promise<void> {
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

/**
 * Fetch checksum for a specific version and platform from the release.
 * Looks for checksums.txt in the release assets.
 * @param version - Version to get checksum for.
 * @returns The checksum or empty string if not available.
 */
async function fetchChecksumFromRelease(version: string): Promise<string> {
  const baseUrl = getDownloadBaseUrl();
  const checksumUrl = `${baseUrl}/electron-app-v${version}/checksums.txt`;

  try {
    const response = await fetch(checksumUrl);
    if (!response.ok) {
      logger.warn("Checksums file not found in release", { version: version });
      return "";
    }

    const text = await response.text();
    const binaryName = getBinaryName();
    const platformKey = getPlatformKey();

    // Parse checksums.txt format: "checksum  filename" or "checksum filename"
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      // Match "checksum  filename" or "checksum filename" format
      const match = trimmed.match(/^([a-fA-F0-9]{64})\s+(.+)$/);
      if (match) {
        const checksum = match[1];
        const filename = match[2];

        // Check if this line is for our binary
        if (filename === binaryName || filename.includes(platformKey)) {
          logger.info("Found checksum in release", {
            version: version,
            platform: platformKey,
            checksum: checksum.substring(0, 16) + "...",
          });
          return checksum;
        }
      }
    }

    logger.warn("Platform checksum not found in checksums.txt", {
      version: version,
      platform: platformKey,
    });
    return "";
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to fetch checksums from release", {
      version: version,
      error: errorMessage,
    });
    return "";
  }
}

/**
 * Download and install a specific version.
 * @param version - Version to download.
 * @param downloadUrl - URL to download from.
 * @param checksum - Optional checksum to verify (if not provided, will fetch from release).
 */
async function downloadAndInstall(
  version: string,
  downloadUrl: string,
  checksum?: string,
): Promise<void> {
  const versionDir = getElectronAppDir(version);
  const binaryName = getBinaryName();

  console.log(`Downloading Muggle Test Electron app v${version}...`);
  console.log(`URL: ${downloadUrl}`);

  // Create directory
  if (existsSync(versionDir)) {
    rmSync(versionDir, { recursive: true, force: true });
  }
  mkdirSync(versionDir, { recursive: true });

  // Download
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const tempFile = path.join(versionDir, binaryName);
  const fileStream = createWriteStream(tempFile);

  if (!response.body) {
    throw new Error("No response body");
  }

  await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream);

  console.log("Download complete, verifying checksum...");

  // Get checksum (from parameter or fetch from release)
  let expectedChecksum = checksum;
  if (!expectedChecksum) {
    expectedChecksum = await fetchChecksumFromRelease(version);
  }

  // Verify checksum
  const checksumResult = await verifyFileChecksum(tempFile, expectedChecksum || "");

  if (!checksumResult.valid && expectedChecksum) {
    rmSync(versionDir, { recursive: true, force: true });
    throw new Error(
      `Checksum verification failed!\n` +
      `Expected: ${checksumResult.expected}\n` +
      `Actual:   ${checksumResult.actual}\n` +
      `The downloaded file may be corrupted or tampered with.`,
    );
  }

  if (expectedChecksum) {
    console.log("Checksum verified successfully.");
  } else {
    console.log("Warning: No checksum available, skipping verification.");
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

  // Save version override
  saveVersionOverride(version);

  console.log(`Electron app v${version} installed to ${versionDir}`);
  logger.info("Upgrade complete", { version: version, path: versionDir });
}

/**
 * Execute the upgrade command.
 * @param options - Command options.
 */
export async function upgradeCommand(options: IUpgradeOptions): Promise<void> {
  try {
    // If specific version requested
    if (options.version) {
      const baseUrl = getDownloadBaseUrl();
      const binaryName = getBinaryName();
      const downloadUrl = `${baseUrl}/electron-app-v${options.version}/${binaryName}`;

      await downloadAndInstall(options.version, downloadUrl);

      // Auto-cleanup old versions (keep current + 1 previous)
      const cleanupResult = cleanupOldVersions({ all: false });
      if (cleanupResult.removed.length > 0) {
        console.log(
          `\nCleaned up ${cleanupResult.removed.length} old version(s), ` +
          `freed ${formatBytes(cleanupResult.freedBytes)}`,
        );
      }
      return;
    }

    // Check for updates
    console.log("Checking for updates...");
    const result = await checkForUpdates();

    console.log(`Current version: ${result.currentVersion}`);
    console.log(`Latest version:  ${result.latestVersion}`);

    if (options.check) {
      if (result.updateAvailable) {
        console.log("\nUpdate available! Run 'muggle upgrade' to install.");
      } else {
        console.log("\nYou are on the latest version.");
      }
      return;
    }

    if (!result.updateAvailable && !options.force) {
      console.log("\nYou are already on the latest version.");
      console.log("Use --force to re-download the current version.");
      return;
    }

    if (!result.downloadUrl) {
      throw new Error("No download URL available");
    }

    // Download and install
    await downloadAndInstall(result.latestVersion, result.downloadUrl);

    // Auto-cleanup old versions (keep current + 1 previous)
    const cleanupResult = cleanupOldVersions({ all: false });
    if (cleanupResult.removed.length > 0) {
      console.log(
        `\nCleaned up ${cleanupResult.removed.length} old version(s), ` +
        `freed ${formatBytes(cleanupResult.freedBytes)}`,
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Upgrade failed: ${errorMessage}`);
    logger.error("Upgrade failed", { error: errorMessage });
    process.exit(1);
  }
}

