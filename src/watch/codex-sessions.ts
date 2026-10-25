import { readdirSync, statSync } from "fs";
import { join } from "path";
import { CODEX_ACTIVE_WINDOW_MS, CODEX_ROLLOUT_DAY_DIRS_SCANNED, CODEX_ROLLOUT_PREFIX } from "./constants.js";
import { cwdFromSessionHead, readFileHead } from "./field-parsers.js";
import { WorkSessionAgent, type WorkSession } from "./types.js";

const ROLLOUT_SESSION_ID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function sortedChildDirsDescending(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function newestDayDirs(sessionsDir: string, limit: number): string[] {
  const dayDirs: string[] = [];
  for (const year of sortedChildDirsDescending(sessionsDir)) {
    for (const month of sortedChildDirsDescending(join(sessionsDir, year))) {
      for (const day of sortedChildDirsDescending(join(sessionsDir, year, month))) {
        dayDirs.push(join(sessionsDir, year, month, day));
        if (dayDirs.length >= limit) return dayDirs;
      }
    }
  }
  return dayDirs;
}

/**
 * Codex sessions whose rollout was written within the active window. Codex keeps
 * no session registry, so a recently appended rollout is the liveness signal; an
 * absent `~/.codex/sessions` simply yields none.
 */
export function readCodexSessions(sessionsDir: string, nowMs: number): WorkSession[] {
  const sessions: WorkSession[] = [];
  for (const dayDir of newestDayDirs(sessionsDir, CODEX_ROLLOUT_DAY_DIRS_SCANNED)) {
    let fileNames: string[];
    try {
      fileNames = readdirSync(dayDir).filter((fileName) => fileName.startsWith(CODEX_ROLLOUT_PREFIX));
    } catch {
      continue;
    }
    for (const fileName of fileNames) {
      const sessionId = fileName.match(ROLLOUT_SESSION_ID)?.[1];
      if (!sessionId) continue;
      const rolloutPath = join(dayDir, fileName);
      let lastActivityAtMs: number;
      try {
        lastActivityAtMs = statSync(rolloutPath).mtimeMs;
      } catch {
        continue;
      }
      if (nowMs - lastActivityAtMs > CODEX_ACTIVE_WINDOW_MS) continue;
      const head = readFileHead(rolloutPath);
      sessions.push({
        agent: WorkSessionAgent.Codex,
        sessionId: sessionId,
        cwd: head === undefined ? undefined : cwdFromSessionHead(head),
        lastActivityAtMs: lastActivityAtMs,
      });
    }
  }
  return sessions;
}
