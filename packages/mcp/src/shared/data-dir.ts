/**
 * Data directory helpers for mcp shared modules.
 */

import * as os from "os";
import * as path from "path";

/** Default data directory name. */
const DATA_DIR_NAME = ".muggle-ai";

/**
 * Get the Muggle AI data directory path.
 * @returns Path to ~/.muggle-ai
 */
export function getDataDir(): string {
  return path.join(os.homedir(), DATA_DIR_NAME);
}
