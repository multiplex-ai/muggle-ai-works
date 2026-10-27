import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { defaultGhRunner, parsePrUrl } from "../pr-walkthrough/gh.js";
import { MUGGLE_DO_SESSIONS_PATH_SEGMENTS, OWNER_FILE_NAME, RESULT_FILE_NAME } from "../pr-watch/constants.js";
import { readJsonRecord, readSlotPr } from "../pr-watch/slotFiles.js";
import type { GhRunner } from "../pr-walkthrough/types.js";
import {
  MAX_WATCH_BLOCKS,
  STOPPED_SLOT_SUFFIX,
  TERMINAL_SLOT_PR_STATES,
  WATCH_HEARTBEAT_STALE_MS,
} from "./constants.js";
import {
  ProviderPrState,
  WatchGateAction,
  WatchSlotStatus,
  type CachedPrStateScan,
  type GuardrailState,
  type WatchGateDecision,
  type WatchSlotEvidence,
} from "./types.js";

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
 * Classify one session slot's watch from what its files say.
 *
 * The heartbeat is the liveness signal, not `watch.pid`: the loop runs under
 * Git Bash, whose PIDs on Windows are MSYS ids that Node's `process.kill(pid, 0)`
 * cannot probe, while the loop touches `watch-heartbeat` every poll on every
 * platform. A slot that is merely seeded never gets one, so it reads as stale.
 */
export function resolveWatchSlotStatus(
  evidence: WatchSlotEvidence,
  nowMs: number,
  staleAfterMs: number = WATCH_HEARTBEAT_STALE_MS,
): WatchSlotStatus {
  if (evidence.isStopped) return WatchSlotStatus.Stopped;
  if (isTerminalSlot(evidence)) return WatchSlotStatus.Terminal;
  const heartbeatAgeMs = evidence.heartbeatMtimeMs === undefined ? Infinity : nowMs - evidence.heartbeatMtimeMs;
  return heartbeatAgeMs <= staleAfterMs ? WatchSlotStatus.Live : WatchSlotStatus.Stale;
}

function isTerminalSlot(evidence: WatchSlotEvidence): boolean {
  const recordedState = evidence.recordedPrState?.toLowerCase() ?? "";
  return evidence.isFinalized || (TERMINAL_SLOT_PR_STATES as readonly string[]).includes(recordedState);
}

/**
 * Whether `sessionId` owns a slot whose PR is still open — the `open` and `blocked` lines of the post-merge status block.
 *
 * Such a slot's watcher needs the session free between turns: a rollover is re-armed, and the watch service resumes
 * the owner, only once the turn ends. A slot is open until it is finalized or records its PR merged or closed; a stale
 * heartbeat still counts. An unreadable sessions dir owns nothing.
 *
 * `sessionsDirOverride` points the scan at a throwaway tree for tests.
 */
export function ownsOpenWatchSlot(sessionId: string, sessionsDirOverride?: string): boolean {
  if (sessionId === "") return false;
  const sessionsDir = sessionsDirOverride ?? join(homedir(), ...MUGGLE_DO_SESSIONS_PATH_SEGMENTS);
  let slugs: string[];
  try {
    slugs = readdirSync(sessionsDir);
  } catch {
    return false;
  }
  return slugs.some((slug) => {
    const slotPath = join(sessionsDir, slug);
    if (readJsonRecord(join(slotPath, OWNER_FILE_NAME)).session_id !== sessionId) return false;
    const slotPr = readSlotPr(slotPath);
    if (typeof slotPr?.url !== "string") return false;
    return !isTerminalSlot({
      isStopped: slug.endsWith(STOPPED_SLOT_SUFFIX),
      isFinalized: existsSync(join(slotPath, RESULT_FILE_NAME)),
      recordedPrState: typeof slotPr.state === "string" ? slotPr.state : undefined,
    });
  });
}

function readHeartbeatMtimeMs(slotPath: string): number | undefined {
  try {
    return statSync(join(slotPath, "watch-heartbeat")).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * The PRs opened this session that no session slot shows a live or settled watch for.
 *
 * Slot dirs are arbitrary slugs, so each is joined back to `prsHandled` on its
 * `prs.json` url. A handled PR counts as watched when any matching slot is live
 * (a fresh heartbeat), terminal (its PR merged or closed, or the slot finalized),
 * or stopped by its owner. A seeded slot with no running loop does not count: a
 * PR left there is one nothing is polling, which is what the gate exists to catch.
 *
 * Unreadable state degrades to "not watched", never to a crash — a slot whose
 * `prs.json` will not parse matches no PR, and a sessions dir that cannot be
 * listed leaves every PR unwatched.
 *
 * `sessionsDirOverride` points the scan at a throwaway tree for tests.
 */
export function findUnwatchedHandledPrs(
  handledUrls: string[],
  sessionsDirOverride?: string,
): string[] {
  if (handledUrls.length === 0) return [];
  const sessionsDir = sessionsDirOverride ?? join(homedir(), ...MUGGLE_DO_SESSIONS_PATH_SEGMENTS);
  let slugs: string[];
  try {
    slugs = readdirSync(sessionsDir);
  } catch {
    return [...handledUrls];
  }

  const nowMs = Date.now();
  const watchedUrls = new Set<string>();
  for (const slug of slugs) {
    const slotPath = join(sessionsDir, slug);
    const slotPr = readSlotPr(slotPath);
    const slotUrl = slotPr?.url;
    if (typeof slotUrl !== "string" || !handledUrls.includes(slotUrl)) continue;
    const evidence: WatchSlotEvidence = {
      isStopped: slug.endsWith(STOPPED_SLOT_SUFFIX),
      isFinalized: existsSync(join(slotPath, RESULT_FILE_NAME)),
      recordedPrState: typeof slotPr?.state === "string" ? slotPr.state : undefined,
      heartbeatMtimeMs: readHeartbeatMtimeMs(slotPath),
    };
    if (resolveWatchSlotStatus(evidence, nowMs) !== WatchSlotStatus.Stale) watchedUrls.add(slotUrl);
  }
  return handledUrls.filter((url) => !watchedUrls.has(url));
}

// The session's own terminal records carry only the PR number, so a
// same-numbered PR in another repo going terminal clears this one too — a
// fail-open the gate accepts for a check that needs no network.
function isTerminalThisSession(prUrl: string, state: GuardrailState): boolean {
  const prNumber = parsePrUrl(prUrl)?.prNumber;
  if (prNumber === undefined) return false;
  return (state.terminalPending ?? []).includes(prNumber) || (state.terminalHandled ?? []).includes(prNumber);
}

function isEndState(providerState: ProviderPrState | undefined): boolean {
  return providerState === ProviderPrState.Merged || providerState === ProviderPrState.Closed;
}

/**
 * Narrow the unwatched PRs to the ones still open, so a merged or closed PR whose
 * slot post-merge cleanup already deleted never holds the turn.
 *
 * A merge the session saw clears its PR from the terminal records; the provider
 * scan covers the rest. A PR with no scan entry still blocks: the scan only ever
 * grants an exemption, so before one lands the gate holds exactly where a missing
 * slot always held it. A scan that could not reach the provider clears the PR —
 * arming needs that same provider, so blocking would only push the session
 * toward the skip hatch.
 */
export function resolveOwedWatchPrs(
  unwatchedUrls: string[],
  state: GuardrailState,
  scan: CachedPrStateScan | null,
): string[] {
  return unwatchedUrls.filter((prUrl) => {
    if (isTerminalThisSession(prUrl, state)) return false;
    const providerState = scan?.states[prUrl];
    return providerState === undefined || providerState === ProviderPrState.Open;
  });
}

/**
 * The unwatched PRs whose provider state is worth reading again: every one not
 * already settled as merged or closed. An unreachable entry is re-read too, so
 * one failed lookup never clears an open PR for the rest of the session.
 */
export function prsAwaitingStateScan(
  unwatchedUrls: string[],
  state: GuardrailState,
  scan: CachedPrStateScan | null,
): string[] {
  return unwatchedUrls.filter(
    (prUrl) => !isTerminalThisSession(prUrl, state) && !isEndState(scan?.states[prUrl]),
  );
}

/**
 * The provider's state for one PR, or null for a url this lookup does not cover.
 *
 * Only GitHub PRs are looked up. A GitLab MR stays unscanned, so it keeps
 * blocking until a live slot covers it rather than clearing on a `gh` call that
 * could never have reached it.
 */
export function lookupProviderPrState(prUrl: string, run: GhRunner = defaultGhRunner): ProviderPrState | null {
  if (!parsePrUrl(prUrl)) return null;
  const reportedState = run(["pr", "view", prUrl, "--json", "state", "-q", ".state"])?.trim();
  return (
    Object.values(ProviderPrState).find(
      (providerState) => providerState === reportedState && providerState !== ProviderPrState.Unreachable,
    ) ?? ProviderPrState.Unreachable
  );
}

/**
 * Look up each PR's provider state, leaving out the urls the lookup does not cover.
 *
 * Output shape: `{ states: { "https://github.com/o/r/pull/7": "MERGED" } }`
 */
export function scanProviderPrStates(
  prUrls: string[],
  lookup: (prUrl: string) => ProviderPrState | null = lookupProviderPrState,
): CachedPrStateScan {
  const states: Record<string, ProviderPrState> = {};
  for (const prUrl of prUrls) {
    const providerState = lookup(prUrl);
    if (providerState !== null) states[prUrl] = providerState;
  }
  return { states: states };
}

/**
 * Decide what the Stop hook does about the watcher hand-off.
 *
 * Pure: the caller resolves which PRs still owe a watch and passes them in.
 * - `None`    — nothing owed (no PR opened, every PR watched or settled, or a skip recorded).
 * - `Block`   — an open PR opened this session has no live watch; force the turn on.
 * - `Release` — blocked `maxBlocks` times already; stop nagging so a legitimately
 *               unwatchable PR can't trap the session.
 */
export function watchGateDecision(
  state: GuardrailState,
  unwatchedPrUrls: string[],
  maxBlocks: number = MAX_WATCH_BLOCKS,
): WatchGateDecision {
  const blockCount = state.watchBlockCount ?? 0;
  if (state.watchSkipped === true || unwatchedPrUrls.length === 0) {
    return { action: WatchGateAction.None, blockCount: blockCount, unwatched: unwatchedPrUrls };
  }
  if (blockCount >= maxBlocks) {
    return { action: WatchGateAction.Release, blockCount: blockCount, unwatched: unwatchedPrUrls };
  }
  return {
    action: WatchGateAction.Block,
    blockCount: blockCount + 1,
    unwatched: unwatchedPrUrls,
  };
}
