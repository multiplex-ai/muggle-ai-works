import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureOrphanLedgerForDeadSlot,
  OrphanLedgerSkipReason,
  parsePosixPsOutput,
  parseWindowsProcessJson,
  ProcessRecord,
  selectSuspectOrphanProcesses,
} from "../../watchdog/orphanLedger.js";

function processRecord(overrides: Partial<ProcessRecord>): ProcessRecord {
  return {
    pid: 100,
    ppid: 1,
    name: "node.exe",
    commandLine: "node script.js",
    ...overrides,
  };
}

describe("parseWindowsProcessJson", () => {
  it("parses an array of rows", () => {
    const raw = JSON.stringify([
      { ProcessId: 10, ParentProcessId: 4, Name: "node.exe", CommandLine: "node a.js" },
      { ProcessId: 11, ParentProcessId: 10, Name: "jest.exe", CommandLine: null },
    ]);
    expect(parseWindowsProcessJson(raw)).toEqual([
      { pid: 10, ppid: 4, name: "node.exe", commandLine: "node a.js" },
      { pid: 11, ppid: 10, name: "jest.exe", commandLine: "" },
    ]);
  });

  it("parses ConvertTo-Json's bare object for a single row", () => {
    const raw = JSON.stringify({
      ProcessId: 10,
      ParentProcessId: 4,
      Name: "node.exe",
      CommandLine: "node a.js",
    });
    expect(parseWindowsProcessJson(raw)).toHaveLength(1);
  });

  it("returns empty on malformed JSON and drops invalid rows", () => {
    expect(parseWindowsProcessJson("not json")).toEqual([]);
    expect(
      parseWindowsProcessJson(JSON.stringify([{ ProcessId: "abc", ParentProcessId: 1 }])),
    ).toEqual([]);
  });

  it("truncates oversized command lines", () => {
    const raw = JSON.stringify([
      { ProcessId: 10, ParentProcessId: 4, Name: "node.exe", CommandLine: "x".repeat(1000) },
    ]);
    expect(parseWindowsProcessJson(raw)[0].commandLine).toHaveLength(400);
  });
});

describe("parsePosixPsOutput", () => {
  it("parses pid/ppid/comm/args columns, keeping spaces in args", () => {
    const raw = "  10     4 node node a.js --flag value\n  11    10 jest\n\n";
    expect(parsePosixPsOutput(raw)).toEqual([
      { pid: 10, ppid: 4, name: "node", commandLine: "node a.js --flag value" },
      { pid: 11, ppid: 10, name: "jest", commandLine: "" },
    ]);
  });

  it("skips non-numeric lines", () => {
    expect(parsePosixPsOutput("PID PPID COMM ARGS\n")).toEqual([]);
  });
});

describe("selectSuspectOrphanProcesses", () => {
  it("selects heavy processes whose parent is gone from the table", () => {
    const table = [
      processRecord({ pid: 10, ppid: 9999, name: "node.exe" }),
      processRecord({ pid: 11, ppid: 10, name: "jest.exe" }),
    ];
    expect(selectSuspectOrphanProcesses(table).map((suspect) => suspect.pid)).toEqual([10]);
  });

  it("ignores orphans that are not heavy workloads", () => {
    const table = [processRecord({ pid: 10, ppid: 9999, name: "notepad.exe", commandLine: "" })];
    expect(selectSuspectOrphanProcesses(table)).toEqual([]);
  });

  it("matches heavy patterns in the command line, not just the name", () => {
    const table = [
      processRecord({ pid: 10, ppid: 9999, name: "conhost.exe", commandLine: "jest --ci" }),
    ];
    expect(selectSuspectOrphanProcesses(table)).toHaveLength(1);
  });

  it("never flags system pids or their children", () => {
    const table = [
      processRecord({ pid: 4, ppid: 0, name: "node.exe" }),
      processRecord({ pid: 10, ppid: 0, name: "node.exe" }),
    ];
    expect(selectSuspectOrphanProcesses(table)).toEqual([]);
  });
});

describe("captureOrphanLedgerForDeadSlot", () => {
  let slotDir: string;

  beforeEach(() => {
    slotDir = mkdtempSync(join(tmpdir(), "orphan-ledger-test-"));
  });

  afterEach(() => {
    rmSync(slotDir, { recursive: true, force: true });
  });

  const orphanTable = [processRecord({ pid: 10, ppid: 9999, name: "node.exe" })];

  it("writes a ledger naming the suspects", () => {
    const result = captureOrphanLedgerForDeadSlot({
      slotDir: slotDir,
      nowMs: Date.now(),
      processTable: orphanTable,
    });
    expect(result).toEqual({ written: true, suspectCount: 1 });
    const ledgerFiles = readdirSync(slotDir).filter((name) => name.startsWith("orphan-ledger-"));
    expect(ledgerFiles).toHaveLength(1);
    const ledger = JSON.parse(readFileSync(join(slotDir, ledgerFiles[0]), "utf-8"));
    expect(ledger.reason).toBe("watcher-dead");
    expect(ledger.total_process_count).toBe(1);
    expect(ledger.suspects[0].pid).toBe(10);
  });

  it("skips when a recent ledger exists", () => {
    writeFileSync(join(slotDir, "orphan-ledger-2026-01-01T00-00-00-000Z.json"), "{}");
    const result = captureOrphanLedgerForDeadSlot({
      slotDir: slotDir,
      nowMs: Date.now(),
      processTable: orphanTable,
    });
    expect(result.written).toBe(false);
    expect(result.skipReason).toBe(OrphanLedgerSkipReason.RecentLedgerExists);
  });

  it("captures again once the dedup window has passed", () => {
    writeFileSync(join(slotDir, "orphan-ledger-2026-01-01T00-00-00-000Z.json"), "{}");
    const result = captureOrphanLedgerForDeadSlot({
      slotDir: slotDir,
      nowMs: Date.now(),
      processTable: orphanTable,
      minIntervalMs: 0,
    });
    expect(result.written).toBe(true);
  });

  it("writes nothing when there are no suspects", () => {
    const result = captureOrphanLedgerForDeadSlot({
      slotDir: slotDir,
      nowMs: Date.now(),
      processTable: [processRecord({ pid: 10, ppid: 1 })],
    });
    expect(result.written).toBe(false);
    expect(result.skipReason).toBe(OrphanLedgerSkipReason.NoSuspects);
    expect(readdirSync(slotDir)).toEqual([]);
  });
});
