import { basename } from "path";
import {
  CLAUDE_EXECUTABLE_PATTERN,
  CODEX_EXECUTABLE_PATTERN,
  MAX_ANCESTOR_HOPS,
  MUGGLE_MCP_SERVER_PATTERN,
  PR_WATCH_LOOP_PATTERN,
} from "./constants.js";
import { TrackedProcessKind, type ProcessTableEntry, type TrackedProcess } from "./types.js";

function isAgentExecutable(executableName: string): boolean {
  return CLAUDE_EXECUTABLE_PATTERN.test(executableName) || CODEX_EXECUTABLE_PATTERN.test(executableName);
}

function classifyKind(entry: ProcessTableEntry): TrackedProcessKind | undefined {
  if (CLAUDE_EXECUTABLE_PATTERN.test(entry.executableName)) return TrackedProcessKind.ClaudeCli;
  if (CODEX_EXECUTABLE_PATTERN.test(entry.executableName)) return TrackedProcessKind.CodexCli;
  if (entry.executableName === "node" && MUGGLE_MCP_SERVER_PATTERN.test(entry.commandLine)) {
    return TrackedProcessKind.MuggleMcpServer;
  }
  if (entry.executableName === "bash" && PR_WATCH_LOOP_PATTERN.test(entry.commandLine)) {
    return TrackedProcessKind.PrWatchLoop;
  }
  return undefined;
}

/** The slot dir name a PR watch loop's `--slot` argument names, whichever slash style it uses. */
export function watchSlotSlugOf(commandLine: string): string | undefined {
  const parts = commandLine.match(PR_WATCH_LOOP_PATTERN);
  const slotPath = parts?.[1] ?? parts?.[2];
  if (!slotPath) return undefined;
  return basename(slotPath.replace(/\\/g, "/").replace(/\/+$/, ""));
}

/**
 * Whether a process has lost the agent that launched it.
 *
 * On Windows a dead parent stays dead in the table, so the walk climbs until it
 * meets a Claude or Codex process (attached) or a pid that no longer exists
 * (orphaned); a chain that tops out elsewhere was started by the user. On POSIX
 * a dead parent's children are reparented to init, so pid 1 as the direct
 * parent is the orphan signal.
 */
function isOrphanedFromAgent(
  entry: ProcessTableEntry,
  entriesByPid: Map<number, ProcessTableEntry>,
  platform: NodeJS.Platform,
): boolean {
  if (platform !== "win32") return entry.parentPid === 1;
  let parentPid = entry.parentPid;
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
    if (parentPid === 0) return false;
    const parent = entriesByPid.get(parentPid);
    if (!parent) return true;
    if (isAgentExecutable(parent.executableName)) return false;
    parentPid = parent.parentPid;
  }
  return false;
}

/**
 * The processes the watch reports on, out of the whole table.
 *
 * Output shape: `[{ pid: 41664, parentPid: 64080, kind: "pr-watch-loop", ageMs: 900000, watchSlotSlug: "csv-export" }]`
 */
export function classifyTrackedProcesses(
  table: ProcessTableEntry[],
  platform: NodeJS.Platform,
): TrackedProcess[] {
  const entriesByPid = new Map(table.map((entry) => [entry.pid, entry]));
  const tracked: TrackedProcess[] = [];
  for (const entry of table) {
    const kind = classifyKind(entry);
    if (kind === undefined) continue;
    const isWatchLoop = kind === TrackedProcessKind.PrWatchLoop;
    tracked.push({
      pid: entry.pid,
      parentPid: entry.parentPid,
      kind: kind,
      ageMs: entry.ageMs,
      isOrphaned: isWatchLoop ? undefined : isOrphanedFromAgent(entry, entriesByPid, platform),
      watchSlotSlug: isWatchLoop ? watchSlotSlugOf(entry.commandLine) : undefined,
    });
  }
  return tracked;
}
