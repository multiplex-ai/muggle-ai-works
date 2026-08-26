import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import { withFileLock } from "../store/fileLock.js";
import {
  LEDGER_COMMIT_ATTEMPTS,
  LEDGER_FILE_NAME,
  LEDGER_LOCK_WAIT_MS,
  LEDGER_VERSION,
} from "./constants.js";
import { LedgerProvider, type Ledger, type ThreadEntry } from "./types.js";

const ledgerPath = (slotPath: string): string => join(slotPath, LEDGER_FILE_NAME);

/** A fresh entry for a thread the ledger has not seen. */
export function newThreadEntry(provider: LedgerProvider): ThreadEntry {
  return {
    provider: provider,
    generation: 0,
    humanCommentIds: [],
    coveredCommentIds: [],
    claim: null,
    lastClaimedBySessionId: null,
    lastReplySha: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * The ledger for one pull request.
 *
 * A missing or unreadable file reads as empty — no ledger means no obligations,
 * which keeps the gate failing open on its own inability to check.
 */
export function readLedger(slotPath: string): Ledger {
  const path = ledgerPath(slotPath);
  if (!existsSync(path)) return { version: LEDGER_VERSION, threads: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<Ledger>;
    return { version: parsed.version ?? LEDGER_VERSION, threads: parsed.threads ?? {} };
  } catch {
    return { version: LEDGER_VERSION, threads: {} };
  }
}

function writeLedger(slotPath: string, ledger: Ledger): void {
  const target = ledgerPath(slotPath);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, JSON.stringify(ledger, null, 2));
  renameSync(staging, target);
}

/**
 * Apply a mutation to one thread under the ledger's lock.
 *
 * Re-reads inside the lock so the mutation always sees the committed entry, and
 * bumps its generation on commit. Unlike the session store this never drops a
 * write silently — a lost ledger write is a missed obligation — so it waits and
 * retries, returning `false` only when every attempt failed.
 */
export function commitThread(
  slotPath: string,
  threadId: string,
  mutate: (entry: ThreadEntry) => ThreadEntry,
): boolean {
  mkdirSync(slotPath, { recursive: true });
  for (let attempt = 0; attempt < LEDGER_COMMIT_ATTEMPTS; attempt += 1) {
    const committed = withFileLock(`${ledgerPath(slotPath)}.lock`, LEDGER_LOCK_WAIT_MS, () => {
      const ledger = readLedger(slotPath);
      const current = ledger.threads[threadId] ?? newThreadEntry(LedgerProvider.GitHub);
      const next = mutate(current);
      ledger.threads[threadId] = {
        ...next,
        generation: current.generation + 1,
        updatedAt: new Date().toISOString(),
      };
      writeLedger(slotPath, ledger);
      return true;
    });
    if (committed === true) return true;
  }
  return false;
}
