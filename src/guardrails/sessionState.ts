import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { GuardrailState } from "./types.js";
import { withFileLock } from "./store/fileLock.js";
import { SESSION_STATE_LOCK_WAIT_MS } from "./constants.js";

const baseDir = (override?: string): string =>
  override ?? join(homedir(), ".muggle-ai", "guardrails");

const fileFor = (sessionId: string, override?: string): string =>
  join(baseDir(override), `${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`);

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
  mkdirSync(baseDir(dirOverride), { recursive: true });
  const target = fileFor(state.sessionId, dirOverride);
  const staging = `${target}.${process.pid}.tmp`;
  writeFileSync(staging, JSON.stringify(state, null, 2));
  renameSync(staging, target);
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
