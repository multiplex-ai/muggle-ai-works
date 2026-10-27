import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import { hostname } from "os";
import {
  commitDeferredStateMutations,
  commitState,
  deferStateMutation,
  readState,
  readWalkthroughScan,
  writeWalkthroughScan,
} from "../../guardrails/sessionState";
import { applyStateMutation } from "../../guardrails/stateCommit";
import { StateMutationKind } from "../../guardrails/types";

const PR_URL = "https://github.com/o/r/pull/7";

describe("walkthrough scan sidecar", () => {
  it("reads back what was written, beside the state file rather than inside it", () => {
    const dir = mkdtempSync(join(tmpdir(), "gr-"));
    const scan = { prsHandled: [PR_URL], owed: [PR_URL], verified: [] };
    commitState("s1", (state) => ({ ...state, prsHandled: [PR_URL] }), dir);
    writeWalkthroughScan("s1", scan, dir);
    expect(readWalkthroughScan("s1", dir)).toEqual(scan);
    expect(readState("s1", dir)).toEqual({ sessionId: "s1", prsHandled: [PR_URL], generation: 1 });
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

  it("isolates state per session id", () => {
    commitState("s1", (state) => ({ ...state, prsHandled: [PR_URL] }), dir);
    expect(readState("s2", dir).prsHandled).toEqual([]);
  });
});

describe("commitState", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gr-commit-"));
  });

  it("bumps the generation on every landed write", () => {
    expect(commitState("s", (state) => ({ ...state, e2eRun: true }), dir)).toBeDefined();
    expect(readState("s", dir).generation).toBe(1);
    commitState("s", (state) => ({ ...state, unitTestsGreen: true }), dir);
    expect(readState("s", dir).generation).toBe(2);
  });

  // The mutation must see what is committed, not a copy read before the lock
  // was taken — that gap is the lost update this store exists to close.
  it("passes the committed state to the mutation", () => {
    commitState("s", (state) => ({ ...state, prsHandled: ["a"] }), dir);
    const observedGenerations: number[] = [];
    commitState(
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
    commitState("s", (state) => ({ ...state, e2eRun: true }), dir);
    commitState("s", (state) => state, dir);
    expect(readState("s", dir).generation).toBe(1);
  });

  it("leaves no temp or lock files behind", () => {
    commitState("s", (state) => ({ ...state, e2eRun: true }), dir);
    expect(readdirSync(dir).filter((name) => name.includes(".tmp") || name.endsWith(".lock"))).toEqual([]);
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
  it("writes nothing, and answers undefined, while another writer holds the lock", () => {
    commitState("s", (state) => ({ ...state, e2eRun: true }), dir);
    const lock = join(dir, "s.json.lock");
    writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() }));
    try {
      expect(commitState("s", (state) => ({ ...state, unitTestsGreen: true }), dir)).toBeUndefined();
      expect(readState("s", dir).unitTestsGreen).toBeUndefined();
    } finally {
      unlinkSync(lock);
    }
  });
});


describe("deferred state mutations", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gr-deferred-"));
  });

  const deferredEntries = (): string[] => readdirSync(dir).filter((name) => name.includes(".deferred-"));

  // The writer that defers could not take the lock, so the state file still
  // belongs to the live holder and must not change under it.
  it("persists beside the state file, never inside it", () => {
    commitState("s", (state) => ({ ...state, e2eRun: true }), dir);
    const committedFile = readFileSync(join(dir, "s.json"), "utf-8");
    deferStateMutation("s", { kind: StateMutationKind.Fields, fields: { unitTestsGreen: true } }, dir);
    expect(readFileSync(join(dir, "s.json"), "utf-8")).toBe(committedFile);
    expect(deferredEntries()).toHaveLength(1);
  });

  it("lands every deferred mutation in one commit, oldest first, and removes them", () => {
    commitState("s", (state) => ({ ...state, e2eRun: true }), dir);
    for (let blockCount = 1; blockCount <= 12; blockCount += 1) {
      deferStateMutation("s", { kind: StateMutationKind.Fields, fields: { commentReplyBlockCount: blockCount } }, dir);
    }
    const committed = commitDeferredStateMutations("s", applyStateMutation, dir);
    expect(committed).toEqual(readState("s", dir));
    expect(committed).toMatchObject({ e2eRun: true, commentReplyBlockCount: 12, generation: 2 });
    expect(deferredEntries()).toEqual([]);
  });

  it("leaves another session's deferred mutations for that session", () => {
    deferStateMutation("s", { kind: StateMutationKind.Fields, fields: { unitTestsGreen: true } }, dir);
    deferStateMutation("s-other", { kind: StateMutationKind.Fields, fields: { unitTestsGreen: true } }, dir);
    commitDeferredStateMutations("s", applyStateMutation, dir);
    expect(readState("s-other", dir).unitTestsGreen).toBeUndefined();
    expect(deferredEntries().every((name) => name.startsWith("s-other."))).toBe(true);
    expect(deferredEntries()).toHaveLength(1);
  });
});
