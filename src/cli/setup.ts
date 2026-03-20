/**
 * Setup command - downloads/updates the Electron app.
 */

import { exec } from "child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "fs";
import { arch, platform } from "os";
import { pipeline } from "stream/promises";

import {
  getChecksumForPlatform,
  getDownloadBaseUrl,
  getElectronAppChecksums,
  getElectronAppDir,
  getElectronAppVersion,
  getLogger,
  isElectronAppInstalled,
  verifyFileChecksum,
} from "@muggleai/mcp";

const logger = getLogger();

/**
 * Options for the setup command.
 */
export interface ISetupOptions {
  /** Force re-download even if already installed. */
  force?: boolean;
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
 * Execute the setup command.
 * @param options - Command options.
 */
export async function setupCommand(options: ISetupOptions): Promise<void> {
  const version = getElectronAppVersion();
  const baseUrl = getDownloadBaseUrl();
  const versionDir = getElectronAppDir(version);

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

    const tempFile = `${versionDir}/${binaryName}`;
    const fileStream = createWriteStream(tempFile);

    if (!response.body) {
      throw new Error("No response body");
    }

    await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream);

    console.log("Download complete, verifying checksum...");

    // Verify checksum
    const checksums = getElectronAppChecksums();
    const expectedChecksum = getChecksumForPlatform(checksums);
    const checksumResult = await verifyFileChecksum(tempFile, expectedChecksum);

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
      console.log("Warning: No checksum configured, skipping verification.");
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
    logger.info("Setup complete", { version: version, path: versionDir });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Failed to download Electron app: ${errorMessage}`);
    logger.error("Setup failed", { error: errorMessage });
    process.exit(1);
  }
}

