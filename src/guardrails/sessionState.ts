import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { GuardrailState } from "./types";

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

export function writeState(state: GuardrailState, dirOverride?: string): void {
  mkdirSync(baseDir(dirOverride), { recursive: true });
  writeFileSync(fileFor(state.sessionId, dirOverride), JSON.stringify(state, null, 2));
}

export function isPrHandled(sessionId: string, prUrl: string, dirOverride?: string): boolean {
  return readState(sessionId, dirOverride).prsHandled.includes(prUrl);
}

export function markPrHandled(sessionId: string, prUrl: string, dirOverride?: string): void {
  const state = readState(sessionId, dirOverride);
  if (!state.prsHandled.includes(prUrl)) state.prsHandled.push(prUrl);
  writeState(state, dirOverride);
}
