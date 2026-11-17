import { describe, expect, it } from "vitest";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { WATCH_QOS_LEDGER_ROTATE_BYTES } from "../../watch-qos/constants.js";
import {
  appendWatchQosRecord,
  findWatchQosRecord,
  parseWatchQosLedgerLine,
  readWatchQosCursor,
  readWatchQosPendingRecords,
  readWatchQosRecords,
  resolveWatchQosPaths,
  rotateUploadedWatchQosLedger,
  writeWatchQosCursor,
} from "../../watch-qos/ledger.js";
import { WatchQosDetector, WatchQosHost, WatchQosSignal, type WatchQosLedgerRecord } from "../../watch-qos/types.js";

function freshPaths() {
  return resolveWatchQosPaths(join(mkdtempSync(join(tmpdir(), "watch-qos-ledger-")), "telemetry"));
}

function ledgerRecord(overrides: Partial<WatchQosLedgerRecord> = {}): WatchQosLedgerRecord {
  return {
    at: "2026-11-17T10:00:00.000Z",
    signal: WatchQosSignal.CiRedObserved,
    detector: WatchQosDetector.WatchLoop,
    subjectId: "subject-a",
    headId: "head-a",
    host: WatchQosHost.ClaudeCode,
    ...overrides,
  };
}

describe("appendWatchQosRecord", () => {
  it("writes one JSON line per new record, creating the ledger dir", () => {
    const paths = freshPaths();
    expect(appendWatchQosRecord(paths, ledgerRecord())).toBe(true);
    expect(readFileSync(paths.ledgerFile, "utf-8").trim().split("\n")).toHaveLength(1);
  });

  it("drops a repeat of the same signal, subject and head, whichever detector repeats it", () => {
    const paths = freshPaths();
    appendWatchQosRecord(paths, ledgerRecord());
    expect(appendWatchQosRecord(paths, ledgerRecord({ detector: WatchQosDetector.WatchService, at: "2026-11-17T11:00:00.000Z" }))).toBe(false);
    expect(readWatchQosRecords(paths)).toHaveLength(1);
  });

  it("keeps records that differ in signal, head or occurrence", () => {
    const paths = freshPaths();
    appendWatchQosRecord(paths, ledgerRecord());
    expect(appendWatchQosRecord(paths, ledgerRecord({ signal: WatchQosSignal.CiRedHandled }))).toBe(true);
    expect(appendWatchQosRecord(paths, ledgerRecord({ headId: "head-b" }))).toBe(true);
    expect(appendWatchQosRecord(paths, ledgerRecord({ signal: WatchQosSignal.WatcherDown, headId: undefined, occurrenceKey: "1" }))).toBe(true);
    expect(appendWatchQosRecord(paths, ledgerRecord({ signal: WatchQosSignal.WatcherDown, headId: undefined, occurrenceKey: "2" }))).toBe(true);
    expect(readWatchQosRecords(paths)).toHaveLength(5);
  });

  it("deduplicates against the rotated ledger too", () => {
    const paths = freshPaths();
    appendWatchQosRecord(paths, ledgerRecord());
    writeFileSync(paths.rotatedLedgerFile, readFileSync(paths.ledgerFile));
    writeFileSync(paths.ledgerFile, "");
    expect(appendWatchQosRecord(paths, ledgerRecord())).toBe(false);
  });
});

describe("parseWatchQosLedgerLine", () => {
  it("rejects lines that are not JSON or name an unknown signal", () => {
    expect(parseWatchQosLedgerLine("{not json")).toBeUndefined();
    expect(parseWatchQosLedgerLine(JSON.stringify({ ...ledgerRecord(), signal: "made-up" }))).toBeUndefined();
  });

  it("drops a delay that is not a finite number", () => {
    expect(parseWatchQosLedgerLine(JSON.stringify({ ...ledgerRecord(), delaySeconds: "soon" }))?.delaySeconds).toBeUndefined();
  });
});

describe("findWatchQosRecord", () => {
  it("finds the first record of a signal on a PR and head", () => {
    const paths = freshPaths();
    appendWatchQosRecord(paths, ledgerRecord());
    expect(findWatchQosRecord(paths, WatchQosSignal.CiRedObserved, "subject-a", "head-a")?.at).toBe("2026-11-17T10:00:00.000Z");
    expect(findWatchQosRecord(paths, WatchQosSignal.CiRedObserved, "subject-a", "head-b")).toBeUndefined();
  });
});

describe("upload cursor", () => {
  it("starts at zero and round-trips", () => {
    const paths = freshPaths();
    expect(readWatchQosCursor(paths)).toEqual({ offset: 0 });
    writeWatchQosCursor(paths, { offset: 42 });
    expect(readWatchQosCursor(paths)).toEqual({ offset: 42 });
  });

  it("reads only complete lines past the offset", () => {
    const paths = freshPaths();
    appendWatchQosRecord(paths, ledgerRecord());
    const firstLineEnd = statSync(paths.ledgerFile).size;
    appendWatchQosRecord(paths, ledgerRecord({ headId: "head-b" }));
    appendFileSync(paths.ledgerFile, '{"partial":');
    const pending = readWatchQosPendingRecords(paths, firstLineEnd);
    expect(pending.records.map((pendingRecord) => pendingRecord.record?.headId)).toEqual(["head-b"]);
    expect(pending.endOffset).toBe(statSync(paths.ledgerFile).size - '{"partial":'.length);
  });

  it("reads from the start when the offset is past a replaced ledger", () => {
    const paths = freshPaths();
    appendWatchQosRecord(paths, ledgerRecord());
    expect(readWatchQosPendingRecords(paths, 10_000).records).toHaveLength(1);
  });
});

describe("rotateUploadedWatchQosLedger", () => {
  it("rotates a fully uploaded ledger past the cap and resets the cursor", () => {
    const paths = freshPaths();
    appendWatchQosRecord(paths, ledgerRecord());
    appendFileSync(paths.ledgerFile, "\n".repeat(WATCH_QOS_LEDGER_ROTATE_BYTES));
    const size = statSync(paths.ledgerFile).size;
    expect(rotateUploadedWatchQosLedger(paths, size)).toBe(true);
    expect(existsSync(paths.ledgerFile)).toBe(false);
    expect(existsSync(paths.rotatedLedgerFile)).toBe(true);
    expect(readWatchQosCursor(paths)).toEqual({ offset: 0 });
  });

  it("leaves a ledger with records not yet uploaded", () => {
    const paths = freshPaths();
    appendWatchQosRecord(paths, ledgerRecord());
    appendFileSync(paths.ledgerFile, "\n".repeat(WATCH_QOS_LEDGER_ROTATE_BYTES));
    expect(rotateUploadedWatchQosLedger(paths, 0)).toBe(false);
  });
});
