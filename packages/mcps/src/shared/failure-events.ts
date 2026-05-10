/**
 * Append-only JSONL log for structured failure-mode telemetry events.
 *
 * Skills classify replay/regen failures and record their classification + the
 * user's chosen action here. The file is later analyzed (grep/jq/CLI) to
 * measure AI classification accuracy and refine guidance — see
 * `plugin/skills/_shared/failure-mode-handling.md`.
 *
 * Lives under the global Muggle data dir (`~/.muggle-ai/telemetry/`),
 * not per-repo, because failure-mode signal is cross-project by design.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getDataDir } from "./data-dir.js";
import { getLogger } from "./logger.js";

const TELEMETRY_DIR_NAME = "telemetry";
const FAILURE_EVENTS_FILE_NAME = "failure-events.jsonl";

export interface IFailureEventRecord {
  ts: string;
  eventType: string;
  skillName: string;
  aiClassification?: string;
  aiSuggestion?: string;
  userAction?: string;
  runId?: string;
  testCaseId?: string;
  projectId?: string;
  signals?: string[];
  metadata?: Record<string, unknown>;
}

/** Absolute path to the failure-events JSONL log. */
export function getFailureEventsFilePath(): string {
  return path.join(getDataDir(), TELEMETRY_DIR_NAME, FAILURE_EVENTS_FILE_NAME);
}

/** Append one event line. Swallows all errors — telemetry must never fail the skill. */
export function appendFailureEvent(record: Omit<IFailureEventRecord, "ts">): void {
  try {
    const dir = path.join(getDataDir(), TELEMETRY_DIR_NAME);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, FAILURE_EVENTS_FILE_NAME);
    const full: IFailureEventRecord = { ts: new Date().toISOString(), ...record };
    fs.appendFileSync(filePath, `${JSON.stringify(full)}\n`, "utf-8");
  } catch (error) {
    getLogger().warn("Failed to append failure event", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
