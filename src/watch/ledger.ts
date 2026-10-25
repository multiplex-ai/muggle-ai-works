import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { withFileLock } from "../guardrails/store/fileLock.js";
import {
  WATCH_EVENTS_FILE,
  WATCH_EVENTS_ROTATE_BYTES,
  WATCH_LOCK_FILE,
  WATCH_LOCK_WAIT_MS,
  WATCH_STATE_FILE,
  WATCH_STATUS_FILE,
} from "./constants.js";
import type { WatchEvent, WatchLedgerState, WatchSnapshot } from "./types.js";

/** The state a watch with no history starts from. */
export function emptyLedgerState(): WatchLedgerState {
  return { activeFindings: {}, recoveryAttemptsByOwner: {}, terminalPrsByUrl: {} };
}

// Written beside the target and renamed over it, so `muggle watch status` never
// reads a half-written snapshot while a tick is writing one.
function writeJsonAtomically(filePath: string, contents: unknown): void {
  const stagingPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(stagingPath, `${JSON.stringify(contents, null, 2)}\n`);
  renameSync(stagingPath, filePath);
}

/** The ledger carried from the last tick; a missing or corrupt file reads as a fresh start. */
export function readWatchLedgerState(watchDir: string): WatchLedgerState {
  try {
    const parsed = JSON.parse(readFileSync(join(watchDir, WATCH_STATE_FILE), "utf-8")) as Partial<WatchLedgerState>;
    return {
      ...parsed,
      activeFindings: parsed.activeFindings ?? {},
      recoveryAttemptsByOwner: parsed.recoveryAttemptsByOwner ?? {},
      terminalPrsByUrl: parsed.terminalPrsByUrl ?? {},
    };
  } catch {
    return emptyLedgerState();
  }
}

/** Persist the ledger for the next tick. */
export function writeWatchLedgerState(watchDir: string, state: WatchLedgerState): void {
  mkdirSync(watchDir, { recursive: true });
  writeJsonAtomically(join(watchDir, WATCH_STATE_FILE), state);
}

/** The last tick's snapshot, or null before the first tick. */
export function readWatchSnapshot(watchDir: string): WatchSnapshot | null {
  try {
    return JSON.parse(readFileSync(join(watchDir, WATCH_STATUS_FILE), "utf-8")) as WatchSnapshot;
  } catch {
    return null;
  }
}

/** Replace the stored snapshot with this tick's. */
export function writeWatchSnapshot(watchDir: string, snapshot: WatchSnapshot): void {
  mkdirSync(watchDir, { recursive: true });
  writeJsonAtomically(join(watchDir, WATCH_STATUS_FILE), snapshot);
}

/** Append events to `events.jsonl`, first rotating it to `events.1.jsonl` once it outgrows its budget. */
export function appendWatchEvents(watchDir: string, events: WatchEvent[]): void {
  if (events.length === 0) return;
  mkdirSync(watchDir, { recursive: true });
  const eventsPath = join(watchDir, WATCH_EVENTS_FILE);
  try {
    if (statSync(eventsPath).size > WATCH_EVENTS_ROTATE_BYTES) {
      renameSync(eventsPath, join(watchDir, WATCH_EVENTS_FILE.replace(/\.jsonl$/, ".1.jsonl")));
    }
  } catch {
    // No events file yet — nothing to rotate.
  }
  appendFileSync(eventsPath, events.map((event) => `${JSON.stringify(event)}\n`).join(""));
}

/**
 * Run `run` holding the watch lock, so a manual `reload-plugins` and a scheduled
 * tick never interleave their reads and writes of the ledger.
 *
 * @returns undefined when the lock could not be taken in time.
 */
export function withWatchLock<T>(watchDir: string, run: () => T, waitMs: number = WATCH_LOCK_WAIT_MS): T | undefined {
  mkdirSync(watchDir, { recursive: true });
  return withFileLock(join(watchDir, WATCH_LOCK_FILE), waitMs, run);
}
