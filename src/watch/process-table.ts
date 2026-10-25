import { COMMAND_LINE_EXECUTABLE_PATTERN } from "./constants.js";
import type { CommandRunner, ProcessTableEntry } from "./types.js";

interface CimProcessRow {
  p?: unknown;
  pp?: unknown;
  n?: unknown;
  c?: unknown;
  s?: unknown;
}

// Every process is listed so ancestry can be walked, but only the executables
// the watch classifies carry their command line and start time — a full table
// with every command line runs to megabytes on a busy box.
function buildWindowsProcessTableScript(): string {
  const keptExecutables = COMMAND_LINE_EXECUTABLE_PATTERN.source.replace(/'/g, "''");
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    `$kept = '${keptExecutables}'`,
    "$rows = @(Get-CimInstance Win32_Process | ForEach-Object {",
    "  $base = ($_.Name -replace '\\.exe$', '').ToLowerInvariant()",
    "  $isKept = $base -match $kept",
    "  [pscustomobject]@{",
    "    p = [int]$_.ProcessId",
    "    pp = [int]$_.ParentProcessId",
    "    n = $base",
    "    c = $(if ($isKept) { [string]$_.CommandLine } else { '' })",
    "    s = $(if ($isKept -and $_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null })",
    "  }",
    "})",
    "ConvertTo-Json -InputObject $rows -Compress",
  ].join("\n");
}

function readWindowsProcessTable(runCommand: CommandRunner, nowMs: number): ProcessTableEntry[] | null {
  const encodedScript = Buffer.from(buildWindowsProcessTableScript(), "utf16le").toString("base64");
  // Windows PowerShell rather than pwsh: it ships with every Windows install.
  const outcome = runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript]);
  if (!outcome || outcome.exitCode !== 0) return null;
  let rows: CimProcessRow[];
  try {
    const parsed = JSON.parse(outcome.stdout) as unknown;
    rows = (Array.isArray(parsed) ? parsed : [parsed]) as CimProcessRow[];
  } catch {
    return null;
  }
  const entries: ProcessTableEntry[] = [];
  for (const row of rows) {
    if (typeof row.p !== "number" || typeof row.pp !== "number") continue;
    entries.push({
      pid: row.p,
      parentPid: row.pp,
      executableName: typeof row.n === "string" ? row.n : "",
      commandLine: typeof row.c === "string" ? row.c : "",
      ageMs: typeof row.s === "number" ? Math.max(0, nowMs - row.s) : undefined,
    });
  }
  return entries;
}

/** Seconds in a `ps` elapsed-time field: `[[dd-]hh:]mm:ss`. */
export function parsePsElapsedSeconds(elapsed: string): number | undefined {
  const parts = elapsed.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!parts) return undefined;
  const [, days, hours, minutes, seconds] = parts;
  return Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes) * 60 + Number(seconds);
}

function executableNameOf(commandLine: string): string {
  const firstToken = commandLine.trim().split(/\s+/)[0] ?? "";
  const baseName = firstToken.split(/[\\/]/).pop() ?? "";
  return baseName.replace(/\.exe$/i, "").toLowerCase();
}

function readPosixProcessTable(runCommand: CommandRunner): ProcessTableEntry[] | null {
  const outcome = runCommand("ps", ["-axo", "pid=,ppid=,etime=,command="]);
  if (!outcome || outcome.exitCode !== 0) return null;
  const entries: ProcessTableEntry[] = [];
  for (const line of outcome.stdout.split("\n")) {
    const columns = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!columns) continue;
    const commandLine = columns[4].trim();
    const executableName = executableNameOf(commandLine);
    const elapsedSeconds = parsePsElapsedSeconds(columns[3]);
    entries.push({
      pid: Number(columns[1]),
      parentPid: Number(columns[2]),
      executableName: executableName,
      commandLine: COMMAND_LINE_EXECUTABLE_PATTERN.test(executableName) ? commandLine : "",
      ageMs: elapsedSeconds === undefined ? undefined : elapsedSeconds * 1000,
    });
  }
  return entries;
}

/**
 * Every process on the machine, or null when the table could not be read.
 *
 * Output shape: `[{ pid: 4120, parentPid: 880, executableName: "node", commandLine: "node muggle.js serve", ageMs: 61000 }]`
 */
export function readProcessTable(
  platform: NodeJS.Platform,
  runCommand: CommandRunner,
  nowMs: number,
): ProcessTableEntry[] | null {
  return platform === "win32" ? readWindowsProcessTable(runCommand, nowMs) : readPosixProcessTable(runCommand);
}
