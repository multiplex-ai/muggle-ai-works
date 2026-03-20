/**
 * Browser opening utility for @muggleai/works.
 * Opens URLs in the user's default browser.
 */

import { exec } from "child_process";
import { platform } from "os";

import { getLogger } from "./logger.js";

const logger = getLogger();

/**
 * Result of attempting to open a browser.
 */
export interface IBrowserOpenResult {
  /** Whether the browser was successfully opened. */
  opened: boolean;
  /** Error message if failed to open. */
  error?: string;
}

/**
 * Options for opening a browser.
 */
export interface IBrowserOpenOptions {
  /** URL to open. */
  url: string;
}

/**
 * Get the command to open a URL based on platform.
 * @param url - URL to open.
 * @returns Platform-specific command.
 */
function getOpenCommand(url: string): string {
  const platformName = platform();

  switch (platformName) {
    case "darwin":
      return `open "${url}"`;
    case "win32":
      return `start "" "${url}"`;
    case "linux":
      return `xdg-open "${url}"`;
    default:
      throw new Error(`Unsupported platform: ${platformName}`);
  }
}

/**
 * Open a URL in the user's default browser.
 * @param options - Options containing the URL to open.
 * @returns Result indicating success or failure.
 */
export async function openBrowserUrl(options: IBrowserOpenOptions): Promise<IBrowserOpenResult> {
  return new Promise((resolve) => {
    try {
      const command = getOpenCommand(options.url);

      logger.debug("[Browser] Opening URL", { url: options.url, command: command });

      exec(command, (error) => {
        if (error) {
          logger.warn("[Browser] Failed to open URL", {
            url: options.url,
            error: error.message,
          });
          resolve({
            opened: false,
            error: error.message,
          });
        } else {
          logger.info("[Browser] URL opened successfully", { url: options.url });
          resolve({ opened: true });
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn("[Browser] Failed to open URL", {
        url: options.url,
        error: errorMessage,
      });
      resolve({
        opened: false,
        error: errorMessage,
      });
    }
  });
}
