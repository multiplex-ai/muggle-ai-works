import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { MAX_WATCH_BLOCKS } from "./constants.js";
import { WatchGateAction, type GuardrailState, type WatchGateDecision } from "./types.js";

// reconcile.md treats a watch-heartbeat older than this as a dead poller.
const HEARTBEAT_FRESH_MS = 15 * 60 * 1000;

// A deliberate "no watcher owed here" declaration: the model runs
// `echo "MUGGLE_WATCH_SKIP: <reason>"` and the gate stays quiet for the session
// (autoWatchPR=never, a manually-opened PR, one handed off elsewhere, an
// already-terminal PR). Anchored to a leading echo for the same reason the E2E
// skip marker is — a grep, commit, or skill edit that merely mentions the token
// must not disarm the gate.
const WATCH_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_WATCH_SKIP\b/;

/** Whether a Bash command is the explicit watcher-skip declaration. */
export function isWatchSkipMarker(cmd: string): boolean {
  return WATCH_SKIP_MARKER.test(cmd);
}

/** Record a watcher skip into the gate state, returning the same reference when nothing changed so the caller can skip a redundant write. */
export function applyWatchSkip(state: GuardrailState, skipped: boolean): GuardrailState {
  if (!skipped || state.watchSkipped === true) return state;
  return { ...state, watchSkipped: true };
}

// A slot counts as watched when its PR is terminal (result.md — nothing left to
// watch), a live monitor owns it (watch.pid names a signalable process), or a
// quiet monitor touched its heartbeat within reconcile's liveness window.
function slotHasArmedWatcher(slotDir: string): boolean {
  if (existsSync(join(slotDir, "result.md"))) return true;

  const pidFile = join(slotDir, "watch.pid");
  if (existsSync(pidFile)) {
    const pid = Number.parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        // ESRCH = the process is gone; EPERM = alive but owned by another user.
        if ((err as NodeJS.ErrnoException).code === "EPERM") return true;
      }
    }
  }

  const beat = join(slotDir, "watch-heartbeat");
  if (existsSync(beat)) {
    try {
      if (Date.now() - statSync(beat).mtimeMs < HEARTBEAT_FRESH_MS) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * The PRs opened this session that have no armed watcher.
 *
 * Scans the muggle-do session slots and joins on the PR url (slot dirs are
 * arbitrary slugs, so the url is the only stable key back to `prsHandled`). A
 * handled url with no slot, or a slot with no armed watcher, is owed.
 * `sessionsDirOverride` points the scan at a throwaway tree for tests.
 */
export function findUnarmedHandledPrs(
  handledUrls: string[],
  sessionsDirOverride?: string,
): string[] {
  if (handledUrls.length === 0) return [];
  const sessionsDir =
    sessionsDirOverride ?? join(homedir(), ".muggle-ai", "muggle-do", "sessions");
  if (!existsSync(sessionsDir)) return [...handledUrls];

  const watchedUrls = new Set<string>();
  for (const slug of readdirSync(sessionsDir)) {
    const slotDir = join(sessionsDir, slug);
    const prsFile = join(slotDir, "prs.json");
    if (!existsSync(prsFile)) continue;
    let slotUrl: string | undefined;
    try {
      const parsed = JSON.parse(readFileSync(prsFile, "utf-8")) as unknown;
      const entry = Array.isArray(parsed) ? parsed[0] : parsed;
      slotUrl = (entry as { url?: string } | undefined)?.url;
    } catch {
      continue;
    }
    if (slotUrl && handledUrls.includes(slotUrl) && slotHasArmedWatcher(slotDir)) {
      watchedUrls.add(slotUrl);
    }
  }
  return handledUrls.filter((url) => !watchedUrls.has(url));
}

/**
 * Decide what the Stop hook does about the watcher hand-off.
 *
 * Pure: the caller runs the sessions scan and passes the owed urls in.
 * - `None`    — nothing owed (no PR opened, all watched, or a skip recorded).
 * - `Block`   — a PR opened this session has no armed watcher; force the turn on.
 * - `Release` — blocked `maxBlocks` times already; stop nagging so a legitimately
 *               un-watchable PR can't trap the session.
 */
export function watchGateDecision(
  state: GuardrailState,
  owedUrls: string[],
  maxBlocks: number = MAX_WATCH_BLOCKS,
): WatchGateDecision {
  const blockCount = state.watchBlockCount ?? 0;
  if (state.watchSkipped === true || owedUrls.length === 0) {
    return { action: WatchGateAction.None, blockCount: blockCount, owed: owedUrls };
  }
  if (blockCount >= maxBlocks) {
    return { action: WatchGateAction.Release, blockCount: blockCount, owed: owedUrls };
  }
  return { action: WatchGateAction.Block, blockCount: blockCount + 1, owed: owedUrls };
}
