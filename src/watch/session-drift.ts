import { MAX_ANCESTOR_HOPS } from "./constants.js";
import {
  TrackedProcessKind,
  WorkSessionAgent,
  type InstallRecord,
  type ProcessTableEntry,
  type TrackedProcess,
  type WorkSession,
} from "./types.js";

/** The version installed at `atMs`: the newest install at or before it, or undefined before the oldest one. */
export function versionInstalledAt(installs: InstallRecord[], atMs: number): string | undefined {
  let installed: string | undefined;
  for (const install of installs) {
    if (install.atMs <= atMs) installed = install.version;
  }
  return installed;
}

/**
 * When the plugins every live session should run were installed: the newest
 * global muggle works install, or a later user-scope update of the muggle plugin.
 * Undefined when neither is known, which leaves nothing to reload toward.
 */
export function resolveReloadTargetAtMs(installs: InstallRecord[], pluginsChangedAtMs: number | undefined): number | undefined {
  const latestInstallAtMs = installs.length === 0 ? undefined : installs[installs.length - 1].atMs;
  if (latestInstallAtMs === undefined) return pluginsChangedAtMs;
  return pluginsChangedAtMs === undefined ? latestInstallAtMs : Math.max(latestInstallAtMs, pluginsChangedAtMs);
}

// The muggle MCP server a session launched runs under a shell wrapper, so its
// session is the nearest ancestor that is one of the sessions' own processes.
function owningSessionPid(server: TrackedProcess, entriesByPid: Map<number, ProcessTableEntry>, sessionPids: Set<number>): number | undefined {
  let ancestorPid = server.parentPid;
  for (let hop = 0; hop < MAX_ANCESTOR_HOPS; hop++) {
    if (sessionPids.has(ancestorPid)) return ancestorPid;
    const ancestor = entriesByPid.get(ancestorPid);
    if (!ancestor) return undefined;
    ancestorPid = ancestor.parentPid;
  }
  return undefined;
}

/**
 * Stamp each live Claude session with when it last loaded its plugins and the
 * build installed then. A session loads plugins when its process starts, and
 * `/reload-plugins` restarts its muggle MCP server, so the later of the two is
 * the load time. A session whose process is not in the table is left unstamped.
 */
export function stampSessionLoads(
  sessions: WorkSession[],
  table: ProcessTableEntry[],
  tracked: TrackedProcess[],
  installs: InstallRecord[],
  nowMs: number,
): WorkSession[] {
  const entriesByPid = new Map(table.map((entry) => [entry.pid, entry]));
  const sessionPids = new Set(sessions.flatMap((session) => (session.pid === undefined ? [] : [session.pid])));
  const newestServerStartByPid = new Map<number, number>();
  for (const server of tracked) {
    if (server.kind !== TrackedProcessKind.MuggleMcpServer || server.ageMs === undefined) continue;
    const sessionPid = owningSessionPid(server, entriesByPid, sessionPids);
    if (sessionPid === undefined) continue;
    newestServerStartByPid.set(sessionPid, Math.max(newestServerStartByPid.get(sessionPid) ?? 0, nowMs - server.ageMs));
  }
  return sessions.map((session) => {
    const processAgeMs = session.pid === undefined ? undefined : entriesByPid.get(session.pid)?.ageMs;
    if (session.agent !== WorkSessionAgent.Claude || processAgeMs === undefined || session.pid === undefined) return session;
    const loadedAtMs = Math.max(nowMs - processAgeMs, newestServerStartByPid.get(session.pid) ?? 0);
    return { ...session, loadedAtMs: loadedAtMs, loadedVersion: versionInstalledAt(installs, loadedAtMs) };
  });
}
