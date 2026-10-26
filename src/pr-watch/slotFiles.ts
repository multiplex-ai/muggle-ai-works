import { readFileSync } from "fs";
import { join } from "path";
import {
  ENV_FILE_LINE,
  PRS_FILE_NAME,
  WATCH_DUE_CI_RED_FIELD,
  WATCH_DUE_HEAD_FIELD,
  WATCH_DUE_REBASE_FIELD,
} from "./constants.js";
import type { LastSeenPrEntry, SlotPrRecord, WatchDueRecord } from "./types.js";

/** A slot file's text, or empty when it is missing or unreadable. */
export function readSlotText(filePath: string): string {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * The PR a slot tracks: the first entry of its `prs.json` array, or the object itself in a pre-array slot.
 * Undefined when the file is missing or will not parse.
 */
export function readSlotPr(slotPath: string): SlotPrRecord | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(slotPath, PRS_FILE_NAME), "utf-8")) as unknown;
    const slotPr = Array.isArray(parsed) ? parsed[0] : parsed;
    return slotPr !== null && typeof slotPr === "object" ? (slotPr as SlotPrRecord) : undefined;
  } catch {
    return undefined;
  }
}

/** A JSON object read from `filePath`, or an empty one when the file is missing, malformed, or not an object. */
export function readJsonRecord(filePath: string): Record<string, unknown> {
  try {
    return asRecord(JSON.parse(readFileSync(filePath, "utf-8")));
  } catch {
    return {};
  }
}

/** `candidate` when it is a plain object, else an empty one. */
export function asRecord(candidate: unknown): Record<string, unknown> {
  return candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : {};
}

/**
 * One PR's entry out of a `last_seen.json` document, keyed `<owner>/<repo>#<n>`. Malformed text or a missing key
 * reads as an empty entry: no attempt recorded, nothing escalated.
 */
export function lastSeenEntryFor(lastSeenJson: string, prKey: string): LastSeenPrEntry {
  try {
    return asRecord(asRecord(JSON.parse(lastSeenJson))[prKey]) as LastSeenPrEntry;
  } catch {
    return {};
  }
}

/** The `KEY=value` lines of an env-style slot file, quotes and CR stripped. */
export function parseEnvFileLines(envFileText: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const rawLine of envFileText.split("\n")) {
    const fieldMatch = ENV_FILE_LINE.exec(rawLine.replace(/\r$/, ""));
    if (fieldMatch) fields[fieldMatch[1]] = fieldMatch[2];
  }
  return fields;
}

/**
 * The due work a `watch-due.env` records, or null when it records none.
 *
 * Output shape: `{ headSha: "abc", rebaseDueKey: "abc..def", ciRedHeadSha: "" }`
 */
export function parseWatchDueRecord(watchDueText: string): WatchDueRecord | null {
  const fields = parseEnvFileLines(watchDueText);
  const dueRecord: WatchDueRecord = {
    headSha: fields[WATCH_DUE_HEAD_FIELD] ?? "",
    rebaseDueKey: fields[WATCH_DUE_REBASE_FIELD] ?? "",
    ciRedHeadSha: fields[WATCH_DUE_CI_RED_FIELD] ?? "",
  };
  return dueRecord.rebaseDueKey || dueRecord.ciRedHeadSha ? dueRecord : null;
}
