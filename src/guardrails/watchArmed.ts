import { existsSync, readdirSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { MAX_WATCH_BLOCKS } from "./constants.js";
import { WatchGateAction, type GuardrailState, type WatchGateDecision } from "./types.js";

// A deliberate "no watcher owed here" declaration: the model runs
// `echo "MUGGLE_WATCH_SKIP: <reason>"` and the gate stays quiet for the session
// (autoWatchPR=never, a PR handed off elsewhere, a repo nobody watches).
// Anchored to a leading echo for the same reason the E2E skip marker is — a
// grep, commit, or skill edit that merely mentions the token must not disarm
// the gate.
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

/**
 * The PRs opened this session that no session slot tracks.
 *
 * Scans the muggle-do session slots and joins on the PR url — slot dirs are
 * arbitrary slugs, so the url is the only stable key back to `prsHandled`.
 *
 * A slot's **existence** is the bar, not whether a watcher is live right now.
 * Watchers are session-scoped: the monitor and any recovery cron both die with
 * the session that started them, so "a poller is running" is never the durable
 * guarantee. The slot on disk is — reconcile re-arms an open slot whose poller
 * went silent, inside the session that owns it, and finalizes any slot once its
 * PR goes terminal. Since this gate only ever fires on a PR handled by the
 * running session, that session is the slot's owner and recovery applies. So a
 * seeded slot means the PR is followed, while a PR with no slot is the one
 * nothing will ever pick up, and that is what this gate exists to catch.
 * Requiring a
 * live poller instead made the gate fire on the seeded-but-not-yet-armed state
 * that a background job legitimately ends in, pushing the caller toward the
 * skip hatch the gate exists to make unnecessary.
 *
 * `sessionsDirOverride` points the scan at a throwaway tree for tests.
 */
export function findUntrackedHandledPrs(
  handledUrls: string[],
  sessionsDirOverride?: string,
): string[] {
  if (handledUrls.length === 0) return [];
  const sessionsDir =
    sessionsDirOverride ?? join(homedir(), ".muggle-ai", "muggle-do", "sessions");
  if (!existsSync(sessionsDir)) return [...handledUrls];

  const trackedUrls = new Set<string>();
  for (const slug of readdirSync(sessionsDir)) {
    const prsFile = join(sessionsDir, slug, "prs.json");
    if (!existsSync(prsFile)) continue;
    let slotUrl: string | undefined;
    try {
      const parsed = JSON.parse(readFileSync(prsFile, "utf-8")) as unknown;
      const entry = Array.isArray(parsed) ? parsed[0] : parsed;
      slotUrl = (entry as { url?: string } | undefined)?.url;
    } catch {
      continue;
    }
    if (slotUrl) trackedUrls.add(slotUrl);
  }
  return handledUrls.filter((url) => !trackedUrls.has(url));
}

/**
 * Decide what the Stop hook does about the watcher hand-off.
 *
 * Pure: the caller runs the sessions scan and passes the untracked urls in.
 * - `None`    — nothing owed (no PR opened, all tracked, or a skip recorded).
 * - `Block`   — a PR opened this session has no session slot; force the turn on.
 * - `Release` — blocked `maxBlocks` times already; stop nagging so a legitimately
 *               unwatchable PR can't trap the session.
 */
export function watchGateDecision(
  state: GuardrailState,
  untrackedPrUrls: string[],
  maxBlocks: number = MAX_WATCH_BLOCKS,
): WatchGateDecision {
  const blockCount = state.watchBlockCount ?? 0;
  if (state.watchSkipped === true || untrackedPrUrls.length === 0) {
    return { action: WatchGateAction.None, blockCount: blockCount, untracked: untrackedPrUrls };
  }
  if (blockCount >= maxBlocks) {
    return { action: WatchGateAction.Release, blockCount: blockCount, untracked: untrackedPrUrls };
  }
  return {
    action: WatchGateAction.Block,
    blockCount: blockCount + 1,
    untracked: untrackedPrUrls,
  };
}
