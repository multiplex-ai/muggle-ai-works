/**
 * File locations of the taste journal and profile.
 */

import * as path from "path";

import { getDataDir } from "../data-dir.js";
import { TASTE_DIR_NAME, TASTE_PROFILE_FILE_NAME, TASTE_SIGNAL_JOURNAL_FILE_NAME } from "./constants.js";

/**
 * Directory holding the taste journal and profile.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns `~/.muggle-ai/taste`.
 */
export function getTasteDir(dataDirOverride?: string): string {
  return path.join(dataDirOverride ?? getDataDir(), TASTE_DIR_NAME);
}

/**
 * Path of the append-only signal journal.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns `~/.muggle-ai/taste/signals.jsonl`.
 */
export function getTasteSignalJournalPath(dataDirOverride?: string): string {
  return path.join(getTasteDir(dataDirOverride), TASTE_SIGNAL_JOURNAL_FILE_NAME);
}

/**
 * Path of the distilled profile.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns `~/.muggle-ai/taste/profile.json`.
 */
export function getTasteProfilePath(dataDirOverride?: string): string {
  return path.join(getTasteDir(dataDirOverride), TASTE_PROFILE_FILE_NAME);
}
