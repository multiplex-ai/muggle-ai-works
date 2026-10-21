import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { CachedWalkthroughScan, GuardrailState } from "./types.js";
import { withFileLock } from "./store/fileLock.js";
import { SESSION_STATE_LOCK_WAIT_MS } from "./constants.js";

const baseDir = (override?: string): string =>
  override ?? join(homedir(), ".muggle-ai", "guardrails");

const fileFor = (sessionId: string, override?: string, suffix = ".json"): string =>
  join(baseDir(override), `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}${suffix}`);

// A sidecar rather than a state field: the detached scan writes it while the
// session's hooks rewrite the state file, and neither may clobber the other.
const WALKTHROUGH_SCAN_SUFFIX = ".walkthrough-scan.json";

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

/** Replace the state file atomically, so a crash mid-write cannot leave a truncated file behind. */
export function writeState(state: GuardrailState, dirOverride?: string): void {
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

/**
 * Apply a mutation under the store's lock, re-reading first so a concurrent
 * writer's commit is never clobbered, and return the state it committed.
 *
 * Returns `undefined` when the lock could not be taken. Contention resolves to
 * a dropped write rather than a wait: the observers that call this run
 * concurrently on every tool call, and a guardrail that stalls the harness is
 * worse than the nag counter it would have recorded. The lock is held only for
 * the read and the write, so a dropped write means a holder far slower than
 * any commit — never two hooks recording the same call.
 */
export function commitState(
  sessionId: string,
  mutate: (state: GuardrailState) => GuardrailState,
  dirOverride?: string,
): GuardrailState | undefined {
  mkdirSync(baseDir(dirOverride), { recursive: true });
  return withFileLock(`${fileFor(sessionId, dirOverride)}.lock`, SESSION_STATE_LOCK_WAIT_MS, () => {
    const current = readState(sessionId, dirOverride);
    const next = mutate(current);
    if (next === current) return current;
    const committed = { ...next, generation: (current.generation ?? 0) + 1 };
    writeState(committed, dirOverride);
    return committed;
  });
}

/** `commitState`, answering only whether the write landed. */
export function updateState(
  sessionId: string,
  mutate: (state: GuardrailState) => GuardrailState,
  dirOverride?: string,
): boolean {
  return commitState(sessionId, mutate, dirOverride) !== undefined;
}

export function isPrHandled(sessionId: string, prUrl: string, dirOverride?: string): boolean {
  return readState(sessionId, dirOverride).prsHandled.includes(prUrl);
}

export function markPrHandled(sessionId: string, prUrl: string, dirOverride?: string): void {
  const state = readState(sessionId, dirOverride);
  if (!state.prsHandled.includes(prUrl)) state.prsHandled.push(prUrl);
  writeState(state, dirOverride);
}
