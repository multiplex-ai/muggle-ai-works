import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { hostname } from "os";
import {
  commitState,
  readState,
  markPrHandled,
  isPrHandled,
  updateState,
  readWalkthroughScan,
  writeWalkthroughScan,
} from "../../guardrails/sessionState";

describe("walkthrough scan sidecar", () => {
  it("reads back what was written, beside the state file rather than inside it", () => {
    const dir = mkdtempSync(join(tmpdir(), "gr-"));
    const scan = { prsHandled: ["https://github.com/o/r/pull/7"], owed: ["https://github.com/o/r/pull/7"], verified: [] };
    markPrHandled("s1", "https://github.com/o/r/pull/7", dir);
    writeWalkthroughScan("s1", scan, dir);
    expect(readWalkthroughScan("s1", dir)).toEqual(scan);
    expect(readState("s1", dir)).toEqual({ sessionId: "s1", prsHandled: ["https://github.com/o/r/pull/7"] });
  });

  it("is null for a session no scan has landed for", () => {
    expect(readWalkthroughScan("never-scanned", mkdtempSync(join(tmpdir(), "gr-")))).toBeNull();
  });
});

describe("sessionState", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gr-"));
  });

  it("returns empty state for an unknown session", () => {
    expect(readState("s1", dir)).toEqual({ sessionId: "s1", prsHandled: [] });
  });

  it("marks a PR handled and is idempotent", () => {
    markPrHandled("s1", "https://github.com/o/r/pull/7", dir);
    expect(isPrHandled("s1", "https://github.com/o/r/pull/7", dir)).toBe(true);
    markPrHandled("s1", "https://github.com/o/r/pull/7", dir);
    expect(readState("s1", dir).prsHandled).toEqual(["https://github.com/o/r/pull/7"]);
  });

  it("isolates state per session id", () => {
    markPrHandled("s1", "https://github.com/o/r/pull/7", dir);
    expect(isPrHandled("s2", "https://github.com/o/r/pull/7", dir)).toBe(false);
  });
});

describe("updateState", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gr-update-"));
  });

  it("bumps the generation on every landed write", () => {
    expect(updateState("s", (state) => ({ ...state, e2eRun: true }), dir)).toBe(true);
    expect(readState("s", dir).generation).toBe(1);
    updateState("s", (state) => ({ ...state, unitTestsGreen: true }), dir);
    expect(readState("s", dir).generation).toBe(2);
  });

  // The mutation must see what is committed, not a copy read before the lock
  // was taken — that gap is the lost update this store exists to close.
  it("passes the committed state to the mutation", () => {
    updateState("s", (state) => ({ ...state, prsHandled: ["a"] }), dir);
    const observedGenerations: number[] = [];
    updateState(
      "s",
      (state) => {
        observedGenerations.push(state.generation ?? 0);
        return { ...state, prsHandled: [...state.prsHandled, "b"] };
      },
      dir,
    );
    expect(readState("s", dir).prsHandled).toEqual(["a", "b"]);
    expect(observedGenerations).toEqual([1]);
  });

  it("skips the write when the mutation changes nothing", () => {
    updateState("s", (state) => ({ ...state, e2eRun: true }), dir);
    updateState("s", (state) => state, dir);
    expect(readState("s", dir).generation).toBe(1);
  });

  it("leaves no temp or lock files behind", () => {
    updateState("s", (state) => ({ ...state, e2eRun: true }), dir);
    expect(readdirSync(dir).filter((name) => name.includes(".tmp") || name.endsWith(".lock"))).toEqual([]);
  });
});

describe("commitState", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gr-commit-"));
  });

  it("returns the state it committed", () => {
    const committed = commitState("s", (state) => ({ ...state, e2eRun: true }), dir);
    expect(committed).toEqual(readState("s", dir));
    expect(committed?.e2eRun).toBe(true);
  });

  it("returns the state as it stands when the mutation changes nothing", () => {
    commitState("s", (state) => ({ ...state, e2eRun: true }), dir);
    expect(commitState("s", (state) => state, dir)).toEqual(readState("s", dir));
  });

  // A live holder — this process — is never broken out of the lock, so a writer
  // that cannot take it must leave the committed state exactly as it was.
  it("drops the write, and touches nothing, while another writer holds the lock", () => {
    commitState("s", (state) => ({ ...state, e2eRun: true }), dir);
    const lock = join(dir, "s.json.lock");
    writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() }));
    try {
      expect(commitState("s", (state) => ({ ...state, unitTestsGreen: true }), dir)).toBeUndefined();
      expect(updateState("s", (state) => ({ ...state, unitTestsGreen: true }), dir)).toBe(false);
      expect(readState("s", dir).unitTestsGreen).toBeUndefined();
    } finally {
      unlinkSync(lock);
    }
  });
});

