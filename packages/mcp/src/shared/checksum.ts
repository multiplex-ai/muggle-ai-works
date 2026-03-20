/**
 * Checksum verification utilities for downloaded binaries.
 * Uses SHA256 for integrity verification.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { platform } from "os";

import { getLogger } from "./logger.js";

const logger = getLogger();

/**
 * Platform key for checksum lookup.
 */
export type PlatformKey = "darwin-arm64" | "darwin-x64" | "win32-x64" | "linux-x64";

/**
 * Checksums map from package.json muggleConfig.
 */
export interface IChecksums {
  /** macOS ARM64 (Apple Silicon) checksum. */
  "darwin-arm64"?: string;
  /** macOS x64 (Intel) checksum. */
  "darwin-x64"?: string;
  /** Windows x64 checksum. */
  "win32-x64"?: string;
  /** Linux x64 checksum. */
  "linux-x64"?: string;
}

/**
 * Result of checksum verification.
 */
export interface IChecksumResult {
  /** Whether verification passed. */
  valid: boolean;
  /** Expected checksum (from config or release). */
  expected: string;
  /** Actual checksum of downloaded file. */
  actual: string;
  /** Error message if verification failed. */
  error?: string;
}

/**
 * Get the platform key for the current system.
 * @returns The platform key for checksum lookup.
 */
export function getPlatformKey(): PlatformKey {
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
 * @param filePath - Path to the file.
 * @returns The SHA256 checksum as a hex string.
 */
export async function calculateFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);

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
 * @param filePath - Path to the file to verify.
 * @param expectedChecksum - Expected SHA256 checksum.
 * @returns Verification result.
 */
export async function verifyFileChecksum(
  filePath: string,
  expectedChecksum: string,
): Promise<IChecksumResult> {
  if (!expectedChecksum || expectedChecksum.trim() === "") {
    logger.warn("Checksum verification skipped - no checksum provided", {
      file: path.basename(filePath),
    });
    return {
      valid: true,
      expected: "",
      actual: "",
      error: "Checksum verification skipped - no checksum configured",
    };
  }

  try {
    const actualChecksum = await calculateFileChecksum(filePath);
    const normalizedExpected = expectedChecksum.toLowerCase().trim();
    const normalizedActual = actualChecksum.toLowerCase();

    const valid = normalizedExpected === normalizedActual;

    if (!valid) {
      logger.error("Checksum verification failed", {
        file: path.basename(filePath),
        expected: normalizedExpected,
        actual: normalizedActual,
      });
    } else {
      logger.info("Checksum verified successfully", {
        file: path.basename(filePath),
        checksum: normalizedActual,
      });
    }

    return {
      valid: valid,
      expected: normalizedExpected,
      actual: normalizedActual,
      error: valid ? undefined : "Checksum mismatch - file may be corrupted or tampered with",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Checksum calculation failed", {
      file: path.basename(filePath),
      error: errorMessage,
    });

    return {
      valid: false,
      expected: expectedChecksum,
      actual: "",
      error: `Failed to calculate checksum: ${errorMessage}`,
    };
  }
}

/**
 * Get checksum for current platform from checksums map.
 * @param checksums - Checksums map from config.
 * @returns Checksum for current platform, or empty string if not found.
 */
export function getChecksumForPlatform(checksums: IChecksums | undefined): string {
  if (!checksums) {
    return "";
  }

  const platformKey = getPlatformKey();
  return checksums[platformKey] || "";
}
