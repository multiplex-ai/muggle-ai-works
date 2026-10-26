import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { blockFor } from "./command-runner.js";
import { SESSION_EXIT_POLL_MS, SESSION_EXIT_WAIT_MS } from "./constants.js";
import { enumValueOf, optionalString } from "./field-parsers.js";
import { hasLiveProcess } from "./session-liveness.js";
import {
  ClaudeJobState,
  ClaudeSessionKind,
  ClaudeTurnStatus,
  WorkSessionAgent,
  type CommandRunner,
  type WorkSession,
} from "./types.js";

interface ClaudeAgentListing {
  id?: unknown;
  sessionId?: unknown;
  cwd?: unknown;
  kind?: unknown;
  name?: unknown;
  status?: unknown;
  state?: unknown;
  startedAt?: unknown;
  pid?: unknown;
}

// Older `claude agents` releases leave the pid out, so the registry backs it
// up: one file per running Claude process, named `<pid>.json`.
function readPidsBySessionId(registryDir: string): Map<string, number> {
  const pidsBySessionId = new Map<string, number>();
  let fileNames: string[];
  try {
    fileNames = readdirSync(registryDir).filter((fileName) => fileName.endsWith(".json"));
  } catch {
    return pidsBySessionId;
  }
  for (const fileName of fileNames) {
    try {
      const entry = JSON.parse(readFileSync(join(registryDir, fileName), "utf-8")) as { pid?: unknown; sessionId?: unknown };
      if (typeof entry.pid === "number" && typeof entry.sessionId === "string") {
        pidsBySessionId.set(entry.sessionId, entry.pid);
      }
    } catch {
      continue;
    }
  }
  return pidsBySessionId;
}

/**
 * Wait until the session has no process behind it, polling the listing.
 *
 * @returns Whether it exited within `SESSION_EXIT_WAIT_MS`; false also when the listing cannot be read.
 */
export function waitForSessionExit(
  runCommand: CommandRunner,
  registryDir: string,
  sessionId: string,
  sleep: (durationMs: number) => void = blockFor,
): boolean {
  for (let waitedMs = 0; ; waitedMs += SESSION_EXIT_POLL_MS) {
    const sessions = readClaudeSessions(runCommand, registryDir);
    const session = sessions?.find((listed) => listed.sessionId === sessionId);
    if (sessions !== null && (session === undefined || !hasLiveProcess(session))) return true;
    if (waitedMs >= SESSION_EXIT_WAIT_MS) return false;
    sleep(SESSION_EXIT_POLL_MS);
  }
}

/**
 * Every Claude session `claude agents --json` reports as active, interactive and
 * background alike; null when the listing could not be read, so a caller can
 * tell "no sessions" from "unknown".
 */
export function readClaudeSessions(runCommand: CommandRunner, registryDir: string): WorkSession[] | null {
  const outcome = runCommand("claude", ["agents", "--json"]);
  if (!outcome || outcome.exitCode !== 0) return null;
  let listings: ClaudeAgentListing[];
  try {
    const parsed = JSON.parse(outcome.stdout) as unknown;
    if (!Array.isArray(parsed)) return null;
    listings = parsed as ClaudeAgentListing[];
  } catch {
    return null;
  }
  const pidsBySessionId = readPidsBySessionId(registryDir);
  const sessions: WorkSession[] = [];
  for (const listing of listings) {
    const sessionId = optionalString(listing.sessionId);
    if (!sessionId) continue;
    sessions.push({
      agent: WorkSessionAgent.Claude,
      sessionId: sessionId,
      shortId: optionalString(listing.id),
      name: optionalString(listing.name),
      cwd: optionalString(listing.cwd),
      kind: enumValueOf(ClaudeSessionKind, listing.kind),
      turnStatus: enumValueOf(ClaudeTurnStatus, listing.status),
      jobState: enumValueOf(ClaudeJobState, listing.state),
      startedAtMs: typeof listing.startedAt === "number" ? listing.startedAt : undefined,
      pid: typeof listing.pid === "number" ? listing.pid : pidsBySessionId.get(sessionId),
    });
  }
  return sessions;
}
