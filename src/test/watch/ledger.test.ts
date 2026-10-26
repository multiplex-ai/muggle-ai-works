import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  appendWatchEvents,
  emptyLedgerState,
  readWatchLedgerState,
  readWatchSnapshot,
  withWatchLock,
  writeWatchLedgerState,
  writeWatchSnapshot,
} from "../../watch/ledger.js";
import { WatchEventKind, WatchFindingCode, WatchFindingSeverity, type WatchSnapshot } from "../../watch/types.js";
import { makeTempDir } from "./fixtures.js";

describe("watch ledger", () => {
  it("starts empty when there is no state, or the state is corrupt", () => {
    const watchDir = makeTempDir("watch");
    expect(readWatchLedgerState(watchDir)).toEqual(emptyLedgerState());
    writeFileSync(join(watchDir, "state.json"), "{");
    expect(readWatchLedgerState(watchDir)).toEqual(emptyLedgerState());
    const pendingReload = { changedAtMs: 5, respawnedSessionIds: [], notifiedSessionIds: [], skippedSessionIds: [] };
    writeFileSync(join(watchDir, "state.json"), JSON.stringify({ pendingReload: pendingReload }));
    expect(readWatchLedgerState(watchDir)).toEqual({ ...emptyLedgerState(), pendingReload: pendingReload });
  });

  it("round-trips state and snapshots through atomic writes", () => {
    const watchDir = join(makeTempDir("watch"), "nested");
    const state = {
      ...emptyLedgerState(),
      activeFindings: {
        k: { code: WatchFindingCode.CiFailing, severity: WatchFindingSeverity.Alert, subject: "o/r#1", message: "red", firstSeenAt: "t" },
      },
    };
    writeWatchLedgerState(watchDir, state);
    expect(readWatchLedgerState(watchDir)).toEqual(state);
    expect(readWatchSnapshot(watchDir)).toBeNull();
    const snapshot: WatchSnapshot = { takenAt: "t", sessions: [], processes: [], slots: [], findings: [], recoveries: [] };
    writeWatchSnapshot(watchDir, snapshot);
    expect(readWatchSnapshot(watchDir)).toEqual(snapshot);
  });

  it("appends events and rotates the log once it outgrows its budget", () => {
    const watchDir = makeTempDir("watch");
    appendWatchEvents(watchDir, []);
    expect(existsSync(join(watchDir, "events.jsonl"))).toBe(false);
    appendWatchEvents(watchDir, [{ at: "t1", kind: WatchEventKind.Raised, key: "k" }]);
    appendWatchEvents(watchDir, [{ at: "t2", kind: WatchEventKind.Cleared, key: "k" }]);
    expect(readFileSync(join(watchDir, "events.jsonl"), "utf-8").trim().split("\n")).toHaveLength(2);
    writeFileSync(join(watchDir, "events.jsonl"), "x".repeat(5 * 1024 * 1024 + 1));
    appendWatchEvents(watchDir, [{ at: "t3", kind: WatchEventKind.Raised }]);
    expect(existsSync(join(watchDir, "events.1.jsonl"))).toBe(true);
    expect(readFileSync(join(watchDir, "events.jsonl"), "utf-8")).toBe('{"at":"t3","kind":"raised"}\n');
  });

  it("serializes runs behind the watch lock and reports a held lock", () => {
    const watchDir = makeTempDir("watch");
    expect(withWatchLock(watchDir, () => "ran")).toBe("ran");
    mkdirSync(watchDir, { recursive: true });
    // A holder on another host is never broken, so the lock stays held for the whole wait.
    writeFileSync(join(watchDir, "watch.lock"), JSON.stringify({ pid: 1, host: "elsewhere", acquiredAt: "t" }));
    expect(withWatchLock(watchDir, () => "ran", 50)).toBeUndefined();
  });
});
