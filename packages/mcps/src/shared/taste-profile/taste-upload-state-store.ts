/**
 * Local record of what was last uploaded per taste section (`~/.muggle-ai/taste/upload-state.json`).
 */

import * as fs from "fs";
import * as path from "path";

import { getTasteUploadStatePath } from "./taste-paths.js";
import type { TasteUploadState } from "./types.js";

/**
 * Read the upload state.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns Upload state per section; empty when nothing was uploaded or the file is unreadable.
 */
export function readTasteUploadState(dataDirOverride?: string): TasteUploadState {
  const uploadStatePath = getTasteUploadStatePath(dataDirOverride);
  try {
    if (!fs.existsSync(uploadStatePath)) {
      return {};
    }
    const storedUploadState: unknown = JSON.parse(fs.readFileSync(uploadStatePath, "utf-8"));
    return typeof storedUploadState === "object" && storedUploadState !== null
      ? (storedUploadState as TasteUploadState)
      : {};
  } catch {
    return {};
  }
}

/**
 * Record the sections just uploaded, keeping the state of sections this upload did not send.
 * @param uploadedSectionStates - State of each uploaded section, keyed by `user` or project id.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns The upload state as written.
 */
export function recordTasteSectionUploads(
  uploadedSectionStates: TasteUploadState,
  dataDirOverride?: string,
): TasteUploadState {
  const updatedUploadState: TasteUploadState = { ...readTasteUploadState(dataDirOverride), ...uploadedSectionStates };
  const uploadStatePath = getTasteUploadStatePath(dataDirOverride);
  fs.mkdirSync(path.dirname(uploadStatePath), { recursive: true });
  fs.writeFileSync(uploadStatePath, `${JSON.stringify(updatedUploadState, null, 2)}\n`, "utf-8");
  return updatedUploadState;
}

/**
 * Remove the upload state file.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 */
export function clearTasteUploadState(dataDirOverride?: string): void {
  fs.rmSync(getTasteUploadStatePath(dataDirOverride), { force: true });
}