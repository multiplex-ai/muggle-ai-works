import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CachedPrStateScan, CachedWalkthroughScan, GuardrailState, StateMutation } from "./types.js";
import { withFileLock } from "./store/fileLock.js";
import {
  DEFERRED_STATE_LOCK_WAIT_MS,
  DEFERRED_STATE_MUTATION_INFIX,
  E2E_SHELL_BLOCKS_SUFFIX,
  E2E_STOP_VERDICT_SUFFIX,
  SESSION_STATE_LOCK_WAIT_MS,
} from "./constants.js";

const baseDir = (override?: string): string =>
  override ?? join(homedir(), ".muggle-ai", "guardrails");

const sessionFileStem = (sessionId: string): string => sessionId.replace(/[^A-Za-z0-9_-]/g, "_");

const fileFor = (sessionId: string, override?: string, suffix = ".json"): string =>
  join(baseDir(override), `${sessionFileStem(sessionId)}${suffix}`);

// A sidecar rather than a state field: the detached scan writes it while the
// session's hooks rewrite the state file, and neither may clobber the other.
const WALKTHROUGH_SCAN_SUFFIX = ".walkthrough-scan.json";
const PR_STATE_SCAN_SUFFIX = ".pr-state-scan.json";

function writeAtomically(target: string, contents: unknown, dirOverride?: string): void {
  mkdirSync(baseDir(dirOverride), { recursive: true });
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, JSON.stringify(contents, null, 2));
  renameSync(staging, target);
}

export function readState(sessionId: string, dirOverride?: string): GuardrailState {
  const f = fileFor(sessionId, dirOverride);
  if (!existsSync(f)) return { sessionId: sessionId, prsHandled: [] };
  try {
    const raw = JSON.parse(readFileSync(f, "utf-8")) as Partial<GuardrailState>;
    return { ...raw, sessionId: sessionId, prsHandled: raw.prsHandled ?? [] };
  } catch {
    return { sessionId: sessionId, prsHandled: [] };
  }
}

// Atomic, so a crash mid-write cannot leave a truncated file behind. Private:
// every write goes through the session's lock, since of two unlocked
// read-modify-writes the later erases the earlier.
function writeState(state: GuardrailState, dirOverride?: string): void {
  writeAtomically(fileFor(state.sessionId, dirOverride), state, dirOverride);
}

/** The session's last walkthrough scan, or null when none has landed or its file is unreadable. */
export function readWalkthroughScan(sessionId: string, dirOverride?: string): CachedWalkthroughScan | null {
  try {
    return JSON.parse(readFileSync(fileFor(sessionId, dirOverride, WALKTHROUGH_SCAN_SUFFIX), "utf-8")) as CachedWalkthroughScan;
  } catch {
    return null;
  }
}

/** Replace the session's walkthrough scan atomically. */
export function writeWalkthroughScan(sessionId: string, scan: CachedWalkthroughScan, dirOverride?: string): void {
  writeAtomically(fileFor(sessionId, dirOverride, WALKTHROUGH_SCAN_SUFFIX), scan, dirOverride);
}

/** The session's last provider lookup of its unwatched PRs, or null when none has landed or its file is unreadable. */
export function readPrStateScan(sessionId: string, dirOverride?: string): CachedPrStateScan | null {
  try {
    const parsed = JSON.parse(readFileSync(fileFor(sessionId, dirOverride, PR_STATE_SCAN_SUFFIX), "utf-8")) as Partial<CachedPrStateScan> | null;
    return parsed?.states && typeof parsed.states === "object" ? { states: parsed.states } : null;
  } catch {
    return null;
  }
}

/** Replace the session's provider PR-state lookup atomically. */
export function writePrStateScan(sessionId: string, scan: CachedPrStateScan, dirOverride?: string): void {
  writeAtomically(fileFor(sessionId, dirOverride, PR_STATE_SCAN_SUFFIX), scan, dirOverride);
}

/** Write the session's pre-rendered e2e Stop block: the block budget, a newline, then the hook output. */
export function writeE2eStopVerdict(sessionId: string, maxBlocks: number, hookOutput: string, dirOverride?: string): void {
  mkdirSync(baseDir(dirOverride), { recursive: true });
  const target = fileFor(sessionId, dirOverride, E2E_STOP_VERDICT_SUFFIX);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, `${maxBlocks}\n${hookOutput}`);
  renameSync(staging, target);
  // Created here, off the Stop path, because creating a file from Git Bash has
  // taken most of a second where appending to one takes milliseconds.
  writeFileSync(fileFor(sessionId, dirOverride, E2E_SHELL_BLOCKS_SUFFIX), "", { flag: "a" });
}

/** How many e2e Stop blocks the shell returned from the pre-rendered verdict; 0 when it has returned none. */
export function readE2eShellBlockCount(sessionId: string, dirOverride?: string): number {
  try {
    return readFileSync(fileFor(sessionId, dirOverride, E2E_SHELL_BLOCKS_SUFFIX), "utf-8").length;
  } catch {
    return 0;
  }
}

/** Forget the shell's e2e Stop blocks, so a later owed run starts with the full budget. */
export function clearE2eShellBlocks(sessionId: string, dirOverride?: string): void {
  rmSync(fileFor(sessionId, dirOverride, E2E_SHELL_BLOCKS_SUFFIX), { force: true });
}

const lockFor = (sessionId: string, dirOverride?: string): string => `${fileFor(sessionId, dirOverride)}.lock`;

// Only ever called inside the session's lock, which is what makes the re-read
// the committed state rather than a copy a concurrent writer may already have replaced.
function commitUnderHeldLock(
  sessionId: string,
  mutate: (state: GuardrailState) => GuardrailState,
  dirOverride?: string,
): GuardrailState {
  const current = readState(sessionId, dirOverride);
  const next = mutate(current);
  if (next === current) return current;
  const committed = { ...next, generation: (current.generation ?? 0) + 1 };
  writeState(committed, dirOverride);
  return committed;
}

/**
 * Apply a mutation under the store's lock, re-reading first so a concurrent
 * writer's commit is never clobbered, and return the state it committed.
 *
 * Returns `undefined` when the lock could not be taken within the hook's wait,
 * having written nothing. The lock is held only for the read and the write, yet
 * a holder on a loaded machine can sit in that section for seconds, so the
 * caller owns the write from there: `deferStateMutation` keeps it for a later
 * commit rather than letting it vanish.
 */
export function commitState(
  sessionId: string,
  mutate: (state: GuardrailState) => GuardrailState,
  dirOverride?: string,
): GuardrailState | undefined {
  mkdirSync(baseDir(dirOverride), { recursive: true });
  return withFileLock(lockFor(sessionId, dirOverride), SESSION_STATE_LOCK_WAIT_MS, () =>
    commitUnderHeldLock(sessionId, mutate, dirOverride),
  );
}

let deferredMutationSequence = 0;

const deferredMutationPrefix = (sessionId: string): string => `${sessionFileStem(sessionId)}${DEFERRED_STATE_MUTATION_INFIX}`;

// Entries are named <epoch ms>-<pid>-<per-process count>.json; ordering on the
// epoch, then the count, is creation order for any one writer.
function deferredMutationFiles(sessionId: string, dirOverride?: string): string[] {
  const prefix = deferredMutationPrefix(sessionId);
  const creationKey = (name: string): number[] => name.slice(prefix.length, -".json".length).split("-").map(Number);
  try {
    return readdirSync(baseDir(dirOverride))
      .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
      .map((name) => ({ name: name, key: creationKey(name) }))
      .sort((left, right) => left.key[0] - right.key[0] || left.key[2] - right.key[2])
      .map((entry) => join(baseDir(dirOverride), entry.name));
  } catch {
    return [];
  }
}

/**
 * Persist a mutation that could not take the session's lock, for
 * `commitDeferredStateMutations` to apply. Written atomically beside the state
 * file and never into it, so no live holder's commit is touched.
 */
export function deferStateMutation(sessionId: string, mutation: StateMutation, dirOverride?: string): void {
  deferredMutationSequence += 1;
  const entryName = `${Date.now()}-${process.pid}-${deferredMutationSequence}.json`;
  writeAtomically(
    join(baseDir(dirOverride), `${deferredMutationPrefix(sessionId)}${entryName}`),
    mutation,
    dirOverride,
  );
}

/**
 * Apply every deferred mutation of the session, oldest first, in one commit
 * under its lock, then remove them. The entries are read and removed inside the
 * lock, so two concurrent runs never apply one twice.
 *
 * Returns the committed state, or `undefined` when the lock stayed held past
 * `DEFERRED_STATE_LOCK_WAIT_MS`, leaving every entry for the next run.
 */
export function commitDeferredStateMutations(
  sessionId: string,
  applyMutation: (state: GuardrailState, mutation: StateMutation) => GuardrailState,
  dirOverride?: string,
): GuardrailState | undefined {
  mkdirSync(baseDir(dirOverride), { recursive: true });
  return withFileLock(lockFor(sessionId, dirOverride), DEFERRED_STATE_LOCK_WAIT_MS, () => {
    const entryFiles = deferredMutationFiles(sessionId, dirOverride);
    const mutations = entryFiles.flatMap((entryFile): StateMutation[] => {
      try {
        return [JSON.parse(readFileSync(entryFile, "utf-8")) as StateMutation];
      } catch {
        return [];
      }
    });
    const committed = commitUnderHeldLock(sessionId, (state) => mutations.reduce(applyMutation, state), dirOverride);
    // Removed only after the commit lands, so a crash in between re-applies
    // them rather than losing them.
    for (const entryFile of entryFiles) rmSync(entryFile, { force: true });
    return committed;
  });
}
