import { spawnSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ORPHAN_LEDGER_MIN_INTERVAL_MS } from "./constants.js";

export interface ProcessRecord {
  pid: number;
  ppid: number;
  name: string;
  commandLine: string;
}

export interface OrphanLedgerCaptureResult {
  written: boolean;
  suspectCount: number;
  skipReason?: OrphanLedgerSkipReason;
}

export enum OrphanLedgerSkipReason {
  RecentLedgerExists = "recent-ledger-exists",
  NoSuspects = "no-suspects",
}

// Processes worth naming in a post-mortem: agent sessions and the heavy
// workloads they spawn. Anything else orphaned (browser helpers, shell
// leftovers) is noise that would bury the signal.
const HEAVY_WORKLOAD_COMMAND_PATTERN =
  /\b(node|jest|tsc|vitest|esbuild|bash|pwsh|powershell|claude|gh)(\.exe)?\b/i;

const ORPHAN_LEDGER_FILENAME_PREFIX = "orphan-ledger-";
const COMMAND_LINE_MAX_CHARS = 400;

function toProcessRecord(candidate: {
  pid: unknown;
  ppid: unknown;
  name: unknown;
  commandLine: unknown;
}): ProcessRecord | null {
  const pid = Number(candidate.pid);
  const ppid = Number(candidate.ppid);
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(ppid) || ppid < 0) return null;
  return {
    pid: pid,
    ppid: ppid,
    name: String(candidate.name ?? ""),
    commandLine: String(candidate.commandLine ?? "").slice(0, COMMAND_LINE_MAX_CHARS),
  };
}

/** Parses `Get-CimInstance Win32_Process | Select ... | ConvertTo-Json` output (array, or bare object for a single row). */
export function parseWindowsProcessJson(raw: string): ProcessRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const records: ProcessRecord[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const rowRecord = row as Record<string, unknown>;
    const record = toProcessRecord({
      pid: rowRecord.ProcessId,
      ppid: rowRecord.ParentProcessId,
      name: rowRecord.Name,
      commandLine: rowRecord.CommandLine,
    });
    if (record) records.push(record);
  }
  return records;
}

/** Parses `ps -eo pid=,ppid=,comm=,args=` output. */
export function parsePosixPsOutput(raw: string): ProcessRecord[] {
  const records: ProcessRecord[] = [];
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
    if (!match) continue;
    const record = toProcessRecord({
      pid: match[1],
      ppid: match[2],
      name: match[3],
      commandLine: match[4],
    });
    if (record) records.push(record);
  }
  return records;
}

/**
 * Heavy-workload processes whose parent is gone from the table — the abandoned
 * work a dead session leaves behind. Parent-death is inferred, not tracked, so
 * expect some noise (e.g. apps whose launching console closed); this is a
 * forensic ledger, not an alarm.
 */
export function selectSuspectOrphanProcesses(processes: ProcessRecord[]): ProcessRecord[] {
  const livePids = new Set(processes.map((processRecord) => processRecord.pid));
  return processes.filter(
    (processRecord) =>
      processRecord.pid > 4 &&
      processRecord.ppid > 4 &&
      !livePids.has(processRecord.ppid) &&
      HEAVY_WORKLOAD_COMMAND_PATTERN.test(`${processRecord.name} ${processRecord.commandLine}`),
  );
}

export function listProcessTable(): ProcessRecord[] {
  if (process.platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress -Depth 2",
      ],
      { encoding: "utf-8", windowsHide: true, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
    );
    if (result.error) throw result.error;
    return parseWindowsProcessJson(result.stdout ?? "");
  }
  const result = spawnSync("ps", ["-eo", "pid=,ppid=,comm=,args="], {
    encoding: "utf-8",
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return parsePosixPsOutput(result.stdout ?? "");
}

function newestLedgerMtimeMs(slotDir: string): number | null {
  let newestMs: number | null = null;
  let entries: string[];
  try {
    entries = readdirSync(slotDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.startsWith(ORPHAN_LEDGER_FILENAME_PREFIX)) continue;
    try {
      const mtimeMs = statSync(join(slotDir, entry)).mtimeMs;
      if (newestMs === null || mtimeMs > newestMs) newestMs = mtimeMs;
    } catch {
      /* file raced away; ignore */
    }
  }
  return newestMs;
}

/**
 * Writes `<slot>/orphan-ledger-<timestamp>.json` naming suspected orphaned
 * heavy processes at the moment the watchdog finds the slot's watcher dead.
 * At most one ledger per interval per slot; nothing is written when no
 * suspects exist.
 */
export function captureOrphanLedgerForDeadSlot(args: {
  slotDir: string;
  nowMs: number;
  processTable: ProcessRecord[];
  minIntervalMs?: number;
}): OrphanLedgerCaptureResult {
  const minIntervalMs = args.minIntervalMs ?? ORPHAN_LEDGER_MIN_INTERVAL_MS;
  const newestMs = minIntervalMs > 0 ? newestLedgerMtimeMs(args.slotDir) : null;
  if (newestMs !== null && args.nowMs - newestMs < minIntervalMs) {
    return {
      written: false,
      suspectCount: 0,
      skipReason: OrphanLedgerSkipReason.RecentLedgerExists,
    };
  }
  const suspects = selectSuspectOrphanProcesses(args.processTable);
  if (suspects.length === 0) {
    return { written: false, suspectCount: 0, skipReason: OrphanLedgerSkipReason.NoSuspects };
  }
  const capturedAt = new Date(args.nowMs).toISOString();
  const ledgerFilename = `${ORPHAN_LEDGER_FILENAME_PREFIX}${capturedAt.replace(/[:.]/g, "-")}.json`;
  writeFileSync(
    join(args.slotDir, ledgerFilename),
    JSON.stringify(
      {
        captured_at: capturedAt,
        reason: "watcher-dead",
        total_process_count: args.processTable.length,
        suspects: suspects,
      },
      null,
      2,
    ),
  );
  return { written: true, suspectCount: suspects.length };
}
