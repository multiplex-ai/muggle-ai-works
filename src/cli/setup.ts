/**
 * Setup command - downloads/updates the Electron app.
 * Includes retry logic, atomic install, and metadata writing.
 */

import { execFile } from "child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import * as path from "path";
import { arch, platform } from "os";
import { pipeline } from "stream/promises";

import {
  calculateFileChecksum,
  getChecksumForPlatform,
  getDownloadBaseUrl,
  getElectronAppChecksums,
  getElectronAppDir,
  getElectronAppVersion,
  getLogger,
  getPlatformKey,
  isElectronAppInstalled,
  verifyFileChecksum,
} from "../../packages/mcps/src/index.js";

const logger = getLogger();

/** Maximum number of download retry attempts. */
const MAX_RETRY_ATTEMPTS = 3;

/** Base delay in milliseconds for exponential backoff. */
const RETRY_BASE_DELAY_MS = 2000;

/** Install metadata filename. */
const INSTALL_METADATA_FILE_NAME = ".install-metadata.json";

/**
 * Options for the setup command.
 */
export interface ISetupOptions {
  /** Force re-download even if already installed. */
  force?: boolean;
} 

/**
 * Install metadata written after successful setup.
 */
interface IInstallMetadata {
  /** Installed version. */
  version: string;
  /** Archive filename. */
  binaryName: string;
  /** Platform key (e.g., "darwin-arm64"). */
  platformKey: string;
  /** SHA256 checksum of extracted executable. */
  executableChecksum: string;
  /** Expected archive checksum from config. */
  expectedArchiveChecksum: string;
  /** Timestamp of installation. */
  updatedAt: string;
}

/**
 * Get platform-specific binary name.
 * @returns Binary filename.
 */
function getBinaryName(): string {
  const os = platform();
  const architecture = arch();

  switch (os) {
    case "darwin": {
      const darwinArch = architecture === "arm64" ? "arm64" : "x64";
      return `MuggleAI-darwin-${darwinArch}.zip`;
    }
    case "win32":
      return "MuggleAI-win32-x64.zip";
    case "linux":
      return "MuggleAI-linux-x64.zip";
    default:
      throw new Error(`Unsupported platform: ${os}`);
  }
}

/**
 * Get the expected executable path after extraction.
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
 * Extract a zip file using execFile for security.
 * @param zipPath - Path to zip file.
 * @param destDir - Destination directory.
 */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (platform() === "win32") {
      execFile(
        "powershell",
        ["-command", `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`],
        (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        },
      );
    } else {
      execFile("unzip", ["-o", zipPath, "-d", destDir], (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    }
  });
}

/**
 * Extract a tar.gz file using execFile for security.
 * @param tarPath - Path to tar.gz file.
 * @param destDir - Destination directory.
 */
async function extractTarGz(tarPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("tar", ["-xzf", tarPath, "-C", destDir], (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Sleep for a given number of milliseconds.
 * @param ms - Milliseconds to sleep.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download a file with retry logic.
 * @param downloadUrl - URL to download from.
 * @param destPath - Destination file path.
 * @returns True if download succeeded.
 */
async function downloadWithRetry(downloadUrl: string, destPath: string): Promise<boolean> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      if (attempt > 1) {
        const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 2);
        console.log(`Retry attempt ${attempt}/${MAX_RETRY_ATTEMPTS} after ${delayMs}ms delay...`);
        await sleep(delayMs);
      }

      const response = await fetch(downloadUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("No response body received");
      }

      const fileStream = createWriteStream(destPath);
      await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream);

      return true;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Download attempt ${attempt} failed: ${lastError.message}`);

      if (existsSync(destPath)) {
        rmSync(destPath, { force: true });
      }
    }
  }

  if (lastError) {
    throw new Error(`Download failed after ${MAX_RETRY_ATTEMPTS} attempts: ${lastError.message}`);
  }

  return false;
}

/**
 * Write install metadata to disk.
 * @param params - Metadata parameters.
 */
function writeInstallMetadata(params: {
  metadataPath: string;
  version: string;
  binaryName: string;
  platformKey: string;
  executableChecksum: string;
  expectedArchiveChecksum: string;
}): void {
  const metadata: IInstallMetadata = {
    version: params.version,
    binaryName: params.binaryName,
    platformKey: params.platformKey,
    executableChecksum: params.executableChecksum,
    expectedArchiveChecksum: params.expectedArchiveChecksum,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(params.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
}

/**
 * Clean up failed installation artifacts.
 * @param versionDir - Version directory to clean up.
 */
function cleanupFailedInstall(versionDir: string): void {
  if (existsSync(versionDir)) {
    try {
      rmSync(versionDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  }
}

/**
 * Execute the setup command.
 * @param options - Command options.
 */
export async function setupCommand(options: ISetupOptions): Promise<void> {
  const version = getElectronAppVersion();
  const baseUrl = getDownloadBaseUrl();
  const versionDir = getElectronAppDir(version);
  const platformKey = getPlatformKey();

  // Check if already installed
  if (!options.force && isElectronAppInstalled()) {
    console.log(`Electron app v${version} is already installed at ${versionDir}`);
    console.log("Use --force to re-download.");
    return;
  }

  const binaryName = getBinaryName();
  const downloadUrl = `${baseUrl}/v${version}/${binaryName}`;

  console.log(`Downloading Muggle Test Electron app v${version}...`);
  console.log(`URL: ${downloadUrl}`);

  try {
    // Clean up any existing partial installation
    if (existsSync(versionDir)) {
      rmSync(versionDir, { recursive: true, force: true });
    }
    mkdirSync(versionDir, { recursive: true });

    const tempFile = path.join(versionDir, binaryName);

    // Download with retry
    await downloadWithRetry(downloadUrl, tempFile);
    console.log("Download complete, verifying checksum...");

    // Verify checksum
    const checksums = getElectronAppChecksums();
    const expectedChecksum = getChecksumForPlatform(checksums);
    const checksumResult = await verifyFileChecksum(tempFile, expectedChecksum);

    if (!checksumResult.valid && expectedChecksum) {
      cleanupFailedInstall(versionDir);
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
      console.log("Warning: No checksum configured, skipping verification.");
    }

    console.log("Extracting...");

    // Extract based on file type
    if (binaryName.endsWith(".zip")) {
      await extractZip(tempFile, versionDir);
    } else if (binaryName.endsWith(".tar.gz")) {
      await extractTarGz(tempFile, versionDir);
    }

    // Verify extraction succeeded
    const executablePath = getExpectedExecutablePath(versionDir);
    if (!existsSync(executablePath)) {
      cleanupFailedInstall(versionDir);
      throw new Error(
        `Extraction failed: executable not found at expected path.\n` +
        `Expected: ${executablePath}\n` +
        `The archive may be corrupted or in an unexpected format.`,
      );
    }

    // Calculate executable checksum for metadata
    const executableChecksum = await calculateFileChecksum(executablePath);

    // Write install metadata
    const metadataPath = path.join(versionDir, INSTALL_METADATA_FILE_NAME);
    writeInstallMetadata({
      metadataPath: metadataPath,
      version: version,
      binaryName: binaryName,
      platformKey: platformKey,
      executableChecksum: executableChecksum,
      expectedArchiveChecksum: expectedChecksum,
    });

    // Clean up archive file
    rmSync(tempFile, { force: true });

    console.log(`Electron app installed to ${versionDir}`);
    logger.info("Setup complete", { version: version, path: versionDir });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to download Electron app: ${errorMessage}`);
    logger.error("Setup failed", { error: errorMessage });
    process.exit(1);
  }
}

