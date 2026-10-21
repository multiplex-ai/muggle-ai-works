/**
 * Storage for the user's own model API key, in an owner-only file in the Muggle data directory.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getDataDir } from "../data-dir.js";
import { getLogger } from "../logger.js";
import { LLM_CREDENTIALS_FILE_MODE, LLM_CREDENTIALS_FILE_NAME } from "./llm-source-constants.js";
import type { IStoredLlmCredentials } from "./llm-source-types.js";

function getLlmCredentialsFilePath(dataDirOverride?: string): string {
  return path.join(dataDirOverride ?? getDataDir(), LLM_CREDENTIALS_FILE_NAME);
}

/**
 * Read the stored model API key.
 * @param dataDirOverride - Override data dir for testing.
 * @returns The key, or undefined when none is stored or the file is unreadable.
 */
export function readStoredLlmApiKey(dataDirOverride?: string): string | undefined {
  const filePath = getLlmCredentialsFilePath(dataDirOverride);
  try {
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const stored = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<IStoredLlmCredentials>;
    return typeof stored.apiKey === "string" && stored.apiKey.length > 0 ? stored.apiKey : undefined;
  } catch (error) {
    getLogger().warn("Failed to read LLM credentials file", {
      path: filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Store the user's model API key, replacing any previous one. The file is owner-read/write only.
 * @param apiKey - The key to store.
 * @param dataDirOverride - Override data dir for testing.
 */
export function writeStoredLlmApiKey(apiKey: string, dataDirOverride?: string): void {
  const dir = dataDirOverride ?? getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  const credentials: IStoredLlmCredentials = { apiKey: apiKey };
  const filePath = getLlmCredentialsFilePath(dataDirOverride);
  fs.writeFileSync(filePath, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: "utf-8",
    mode: LLM_CREDENTIALS_FILE_MODE,
  });
  // `mode` applies only when the file is created; tighten a file that already existed too.
  fs.chmodSync(filePath, LLM_CREDENTIALS_FILE_MODE);
}

/**
 * Delete the stored model API key, if any.
 * @param dataDirOverride - Override data dir for testing.
 */
export function deleteStoredLlmApiKey(dataDirOverride?: string): void {
  fs.rmSync(getLlmCredentialsFilePath(dataDirOverride), { force: true });
}
