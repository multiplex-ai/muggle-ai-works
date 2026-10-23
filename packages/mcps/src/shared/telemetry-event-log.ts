/**
 * Append-only JSONL logs for structured skill telemetry events.
 *
 * Failure-mode events record how a skill classified a replay/regen failure and
 * the user's chosen action — see `plugin/skills/_shared/failure-mode-handling.md`.
 * Workflow events record what a muggle-do cycle or PR watcher tick did — see
 * `plugin/skills/_shared/telemetry-events.md`. Both are analyzed later
 * (grep/jq/CLI) to refine the skills.
 *
 * The logs live under the global Muggle data dir (`~/.muggle-ai/telemetry/`),
 * not per-repo, because the signal is cross-project by design.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getDataDir } from "./data-dir.js";
import { getLogger } from "./logger.js";
import {
  FAILURE_EVENTS_FILE_NAME,
  TELEMETRY_DIR_NAME,
  WORKFLOW_EVENTS_FILE_NAME,
} from "./telemetry-event-log-constants.js";
import type { IFailureEventRecord, IWorkflowEventRecord } from "./telemetry-event-log-types.js";

/** Absolute path to the failure-events JSONL log. */
export function getFailureEventsFilePath(): string {
  return path.join(getDataDir(), TELEMETRY_DIR_NAME, FAILURE_EVENTS_FILE_NAME);
}

/** Absolute path to the workflow-events JSONL log. */
export function getWorkflowEventsFilePath(): string {
  return path.join(getDataDir(), TELEMETRY_DIR_NAME, WORKFLOW_EVENTS_FILE_NAME);
}

/** Append one failure-mode event line. Swallows all errors — telemetry must never fail the skill. */
export function appendFailureEvent(record: Omit<IFailureEventRecord, "ts">): void {
  const timestampedRecord: IFailureEventRecord = { ts: new Date().toISOString(), ...record };
  appendTelemetryEventLine(getFailureEventsFilePath(), timestampedRecord);
}

/** Append one workflow event line. Swallows all errors — telemetry must never fail the skill. */
export function appendWorkflowEvent(record: Omit<IWorkflowEventRecord, "ts">): void {
  const timestampedRecord: IWorkflowEventRecord = { ts: new Date().toISOString(), ...record };
  appendTelemetryEventLine(getWorkflowEventsFilePath(), timestampedRecord);
}

function appendTelemetryEventLine(logFilePath: string, record: IFailureEventRecord | IWorkflowEventRecord): void {
  try {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    fs.appendFileSync(logFilePath, `${JSON.stringify(record)}\n`, "utf-8");
  } catch (error) {
    getLogger().warn("Failed to append telemetry event", {
      logFilePath: logFilePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
