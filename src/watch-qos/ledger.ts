import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { getDataDir } from "../../packages/mcps/src/shared/data-dir.js";
import {
  WATCH_QOS_CURSOR_FILE_NAME,
  WATCH_QOS_DEDUP_KEY_SEPARATOR,
  WATCH_QOS_DIR_NAME,
  WATCH_QOS_LEDGER_FILE_NAME,
  WATCH_QOS_LEDGER_ROTATE_BYTES,
  WATCH_QOS_ROTATED_LEDGER_FILE_NAME,
} from "./constants.js";
import {
  WatchQosDetector,
  WatchQosHost,
  WatchQosSignal,
  type WatchQosCursor,
  type WatchQosLedgerRecord,
  type WatchQosPaths,
  type WatchQosPendingRecords,
} from "./types.js";

const NEWLINE_BYTE = 0x0a;

/** The ledger files under `watchQosDir`, `~/.muggle-ai/telemetry` by default. */
export function resolveWatchQosPaths(watchQosDir: string = join(getDataDir(), WATCH_QOS_DIR_NAME)): WatchQosPaths {
  return {
    ledgerFile: join(watchQosDir, WATCH_QOS_LEDGER_FILE_NAME),
    rotatedLedgerFile: join(watchQosDir, WATCH_QOS_ROTATED_LEDGER_FILE_NAME),
    cursorFile: join(watchQosDir, WATCH_QOS_CURSOR_FILE_NAME),
  };
}

/** The key two records of one event share: signal, PR, head and occurrence, whichever detector saw it first. */
export function watchQosDedupKey(record: Pick<WatchQosLedgerRecord, "signal" | "subjectId" | "headId" | "occurrenceKey">): string {
  return [record.signal, record.subjectId, record.headId ?? "", record.occurrenceKey ?? ""].join(WATCH_QOS_DEDUP_KEY_SEPARATOR);
}

function isEnumValue<T extends Record<string, string>>(enumObject: T, candidate: unknown): candidate is T[keyof T] {
  return typeof candidate === "string" && (Object.values(enumObject) as string[]).includes(candidate);
}

function optionalStringField(candidate: unknown): string | undefined {
  return typeof candidate === "string" && candidate !== "" ? candidate : undefined;
}

/** One ledger line as a record, or undefined when it is not valid JSON or names an unknown signal, detector or host. */
export function parseWatchQosLedgerLine(line: string): WatchQosLedgerRecord | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const { at, signal, detector, subjectId, host } = parsed;
  if (typeof at !== "string" || typeof subjectId !== "string" || subjectId === "") return undefined;
  if (!isEnumValue(WatchQosSignal, signal) || !isEnumValue(WatchQosDetector, detector) || !isEnumValue(WatchQosHost, host)) {
    return undefined;
  }
  const delaySeconds = parsed.delaySeconds;
  return {
    at: at,
    signal: signal,
    detector: detector,
    subjectId: subjectId,
    headId: optionalStringField(parsed.headId),
    delaySeconds: typeof delaySeconds === "number" && Number.isFinite(delaySeconds) ? delaySeconds : undefined,
    host: host,
    occurrenceKey: optionalStringField(parsed.occurrenceKey),
  };
}

function readLedgerLines(filePath: string): string[] {
  try {
    return readFileSync(filePath, "utf-8").split("\n");
  } catch {
    return [];
  }
}

/** Every readable record of the rotated and live ledgers, oldest first. */
export function readWatchQosRecords(paths: WatchQosPaths): WatchQosLedgerRecord[] {
  return [...readLedgerLines(paths.rotatedLedgerFile), ...readLedgerLines(paths.ledgerFile)].flatMap((line) => {
    const record = line.trim() === "" ? undefined : parseWatchQosLedgerLine(line);
    return record ? [record] : [];
  });
}

/** The first record of one signal on one PR and head, or undefined when none was written. */
export function findWatchQosRecord(
  paths: WatchQosPaths,
  signal: WatchQosSignal,
  subjectId: string,
  headId?: string,
): WatchQosLedgerRecord | undefined {
  return readWatchQosRecords(paths).find(
    (record) => record.signal === signal && record.subjectId === subjectId && record.headId === headId,
  );
}

/**
 * Append one record unless the ledger already holds its dedup key, so a gate that blocks five times records once.
 *
 * @returns Whether the record was written.
 */
export function appendWatchQosRecord(paths: WatchQosPaths, record: WatchQosLedgerRecord): boolean {
  const dedupKey = watchQosDedupKey(record);
  if (readWatchQosRecords(paths).some((existing) => watchQosDedupKey(existing) === dedupKey)) return false;
  mkdirSync(dirname(paths.ledgerFile), { recursive: true });
  appendFileSync(paths.ledgerFile, `${JSON.stringify(record)}\n`);
  return true;
}

/** The upload cursor; a missing or unreadable cursor starts at the beginning of the live ledger. */
export function readWatchQosCursor(paths: WatchQosPaths): WatchQosCursor {
  try {
    const parsed = JSON.parse(readFileSync(paths.cursorFile, "utf-8")) as { offset?: unknown };
    return { offset: typeof parsed.offset === "number" && parsed.offset >= 0 ? parsed.offset : 0 };
  } catch {
    return { offset: 0 };
  }
}

/** Persist the upload cursor. */
export function writeWatchQosCursor(paths: WatchQosPaths, cursor: WatchQosCursor): void {
  mkdirSync(dirname(paths.cursorFile), { recursive: true });
  writeFileSync(paths.cursorFile, `${JSON.stringify({ offset: cursor.offset })}\n`);
}

/**
 * The complete lines of the live ledger past `offset`, each with the offset just past it. A line still being written
 * (no newline yet) is left for the next pass. An offset beyond the file — the ledger was replaced — reads from the
 * start.
 *
 * Output shape: `{ startOffset: 0, records: [{ record: { signal: "pr-opened", … }, endOffset: 141 }], endOffset: 141 }`
 */
export function readWatchQosPendingRecords(paths: WatchQosPaths, offset: number): WatchQosPendingRecords {
  let ledgerBytes: Buffer;
  try {
    ledgerBytes = readFileSync(paths.ledgerFile);
  } catch {
    return { startOffset: 0, records: [], endOffset: 0 };
  }
  const startOffset = offset <= ledgerBytes.length ? offset : 0;
  let lineStart = startOffset;
  const records: WatchQosPendingRecords["records"] = [];
  for (;;) {
    const newlineIndex = ledgerBytes.indexOf(NEWLINE_BYTE, lineStart);
    if (newlineIndex === -1) break;
    const line = ledgerBytes.subarray(lineStart, newlineIndex).toString("utf-8");
    lineStart = newlineIndex + 1;
    if (line.trim() === "") continue;
    records.push({ record: parseWatchQosLedgerLine(line), endOffset: lineStart });
  }
  return { startOffset: startOffset, records: records, endOffset: lineStart };
}

/**
 * Rotate a fully uploaded ledger once it outgrows `WATCH_QOS_LEDGER_ROTATE_BYTES`: the live file becomes the rotated
 * one, replacing the older generation, and the cursor restarts at zero.
 *
 * @returns Whether the ledger was rotated.
 */
export function rotateUploadedWatchQosLedger(paths: WatchQosPaths, uploadedOffset: number): boolean {
  if (!existsSync(paths.ledgerFile)) return false;
  const ledgerSize = statSync(paths.ledgerFile).size;
  if (ledgerSize < WATCH_QOS_LEDGER_ROTATE_BYTES || ledgerSize !== uploadedOffset) return false;
  renameSync(paths.ledgerFile, paths.rotatedLedgerFile);
  writeWatchQosCursor(paths, { offset: 0 });
  return true;
}
