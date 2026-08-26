import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { commitThread, newThreadEntry, readLedger } from "../../guardrails/ledger/store.js";
import { LEDGER_FILE_NAME } from "../../guardrails/ledger/constants.js";
import { LedgerProvider } from "../../guardrails/ledger/types.js";

const slot = (): string => mkdtempSync(join(tmpdir(), "gr-ledger-"));

describe("ledger store", () => {
  it("reads an empty ledger when no file exists", () => {
    expect(readLedger(slot()).threads).toEqual({});
  });

  it("creates an entry and bumps its generation on each commit", () => {
    const path = slot();
    commitThread(path, "T1", () => newThreadEntry(LedgerProvider.GitHub));
    expect(readLedger(path).threads.T1.generation).toBe(1);
    commitThread(path, "T1", (entry) => ({ ...entry, humanCommentIds: ["11"] }));
    const stored = readLedger(path).threads.T1;
    expect(stored.generation).toBe(2);
    expect(stored.humanCommentIds).toEqual(["11"]);
  });

  // The mutation must see the committed entry, not a copy read before the lock
  // was taken — that gap is the lost update the store exists to close.
  it("passes the committed entry to the mutation", () => {
    const path = slot();
    commitThread(path, "T1", () => ({
      ...newThreadEntry(LedgerProvider.GitHub),
      coveredCommentIds: ["11"],
    }));
    let observed: string[] = [];
    commitThread(path, "T1", (entry) => {
      observed = entry.coveredCommentIds;
      return entry;
    });
    expect(observed).toEqual(["11"]);
  });

  it("keeps other threads untouched", () => {
    const path = slot();
    commitThread(path, "T1", () => newThreadEntry(LedgerProvider.GitHub));
    commitThread(path, "T2", () => newThreadEntry(LedgerProvider.GitLab));
    expect(Object.keys(readLedger(path).threads).sort()).toEqual(["T1", "T2"]);
    expect(readLedger(path).threads.T2.provider).toBe(LedgerProvider.GitLab);
  });

  it("leaves no temp or lock files behind", () => {
    const path = slot();
    commitThread(path, "T1", () => newThreadEntry(LedgerProvider.GitHub));
    expect(readdirSync(path).filter((name) => name.includes(".tmp") || name.endsWith(".lock"))).toEqual(
      [],
    );
  });

  // No ledger means no obligations. A gate that blocked on its own inability to
  // read would be a gate that gets deleted.
  it("degrades to an empty ledger when the file is corrupt", () => {
    const path = slot();
    writeFileSync(join(path, LEDGER_FILE_NAME), "{ not json");
    expect(readLedger(path).threads).toEqual({});
  });

  it("reports whether the commit landed", () => {
    expect(commitThread(slot(), "T1", () => newThreadEntry(LedgerProvider.GitHub))).toBe(true);
  });
});
