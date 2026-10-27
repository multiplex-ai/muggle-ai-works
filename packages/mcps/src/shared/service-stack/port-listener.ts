/** Names the process listening on a local TCP port, so the stack check can compare it with what prepare tracks. */

import { execFile } from "node:child_process";
import * as os from "node:os";

import {
  NOTHING_LISTENING,
  PORT_LISTENER_COMMAND_TIMEOUT_MS,
  PORT_LISTENER_MAX_ANCESTORS,
  UNREADABLE_PORT,
} from "./port-listener-constants.js";
import type { IListenerToolOutcome, IPortListener, IPortListenerReading } from "./port-listener-types.js";

/**
 * Read which process listens on a local TCP port, and its parent chain.
 *
 * @param port - The port.
 * @returns The listener; `listener: null` when nothing listens; `isReadable: false` when the platform tool is missing or fails.
 *
 * Output shape: `{ isReadable: true, listener: { pid: 43016, commandLine: "node start.js", ancestorPids: [67240, 72584] } }`
 */
export async function readPortListener(port: number): Promise<IPortListenerReading> {
  return os.platform() === "win32" ? await readWindowsPortListener(port) : await readPosixPortListener(port);
}

async function readWindowsPortListener(port: number): Promise<IPortListenerReading> {
  // netstat answers in a fraction of the time PowerShell takes to start, and settles most checks alone.
  const netstatOutcome = await runListenerTool("netstat", ["-ano"]);
  if (netstatOutcome === null || netstatOutcome.exitCode !== 0) return UNREADABLE_PORT;
  const listenerPid = findWindowsListenerPid({ netstatOutput: netstatOutcome.stdout, port: port });
  if (listenerPid === null) return NOTHING_LISTENING;

  const encodedScript = Buffer.from(buildWindowsAncestryScript(listenerPid), "utf16le").toString("base64");
  // Windows PowerShell rather than pwsh: it ships with every Windows install.
  const outcome = await runListenerTool("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript]);
  if (outcome === null || outcome.exitCode !== 0) {
    return { isReadable: true, listener: { pid: listenerPid, commandLine: "", ancestorPids: [] } };
  }
  try {
    const parsed = JSON.parse(outcome.stdout) as { commandLine?: unknown; ancestorPids?: unknown };
    const ancestorPids = Array.isArray(parsed.ancestorPids) ? parsed.ancestorPids : [parsed.ancestorPids];
    return {
      isReadable: true,
      listener: {
        pid: listenerPid,
        commandLine: typeof parsed.commandLine === "string" ? parsed.commandLine : "",
        ancestorPids: ancestorPids.filter((ancestorPid): ancestorPid is number => typeof ancestorPid === "number"),
      },
    };
  } catch {
    return { isReadable: true, listener: { pid: listenerPid, commandLine: "", ancestorPids: [] } };
  }
}

/** The PID listening on `port` in `netstat -ano` output, IPv4 or IPv6, or null when none is. */
function findWindowsListenerPid(params: { netstatOutput: string; port: number }): number | null {
  for (const line of params.netstatOutput.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0] !== "TCP" || columns[3] !== "LISTENING") continue;
    if (columns[1].endsWith(`:${params.port}`)) return Number(columns[4]);
  }
  return null;
}

function buildWindowsAncestryScript(listenerPid: number): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
    "$parentByPid = @{}",
    "Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId FROM Win32_Process' | ForEach-Object { $parentByPid[[int]$_.ProcessId] = [int]$_.ParentProcessId }",
    `$commandLine = [string](Get-CimInstance -Query 'SELECT CommandLine FROM Win32_Process WHERE ProcessId = ${listenerPid}').CommandLine`,
    "$ancestors = @()",
    `$current = ${listenerPid}`,
    `for ($level = 0; $level -lt ${PORT_LISTENER_MAX_ANCESTORS} -and $parentByPid.ContainsKey($current); $level++) {`,
    "  $current = $parentByPid[$current]",
    "  if ($current -le 0) { break }",
    "  $ancestors += $current",
    "}",
    "ConvertTo-Json -Compress -InputObject @{ commandLine = $commandLine; ancestorPids = @($ancestors) }",
  ].join("\n");
}

async function readPosixPortListener(port: number): Promise<IPortListenerReading> {
  const lsofOutcome = await runListenerTool("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (lsofOutcome === null) return UNREADABLE_PORT;
  const listenerPidLine = lsofOutcome.stdout.split("\n").find((line) => /^\d+$/.test(line.trim()));
  // lsof exits 1 with no output when nothing matches.
  if (listenerPidLine === undefined) return lsofOutcome.exitCode <= 1 ? NOTHING_LISTENING : UNREADABLE_PORT;

  const listenerPid = Number(listenerPidLine.trim());
  const listener: IPortListener = { pid: listenerPid, commandLine: "", ancestorPids: [] };
  let currentPid = listenerPid;
  for (let level = 0; level <= PORT_LISTENER_MAX_ANCESTORS && currentPid > 1; level += 1) {
    const psOutcome = await runListenerTool("ps", ["-o", "ppid=,command=", "-p", String(currentPid)]);
    const columns = psOutcome?.stdout.match(/^\s*(\d+)\s+(.*)$/m);
    if (!columns) break;
    if (level === 0) listener.commandLine = columns[2].trim();
    currentPid = Number(columns[1]);
    if (currentPid > 0) listener.ancestorPids.push(currentPid);
  }
  return { isReadable: true, listener: listener };
}

/** Run a read-only platform tool; null when it could not start or timed out. */
function runListenerTool(command: string, args: string[]): Promise<IListenerToolOutcome | null> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: PORT_LISTENER_COMMAND_TIMEOUT_MS, windowsHide: true, encoding: "utf-8" },
      (error, stdout) => {
        if (error === null) {
          resolve({ exitCode: 0, stdout: stdout });
        } else if (typeof error.code === "number" && !error.killed) {
          resolve({ exitCode: error.code, stdout: stdout });
        } else {
          resolve(null);
        }
      },
    );
  });
}
