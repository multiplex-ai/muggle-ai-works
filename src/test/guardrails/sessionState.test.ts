import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, readdirSync } from "fs";
import { readState, markPrHandled, isPrHandled, updateState } from "../../guardrails/sessionState";

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
