import type { GuardrailState } from "./types.js";

export const MAX_E2E_BLOCKS = 3;

export function shouldRunE2E(state: GuardrailState): boolean {
  return state.unitTestsGreen === true && state.e2eRun !== true && state.e2eSkipped !== true;
}

export interface RecordedRun {
  unitTestPassed?: boolean;
  e2eRan?: boolean;
  e2eSkipped?: boolean;
}

// Fold a recorded test run into the gate state, returning the same reference
// when nothing was recorded so the caller can skip a redundant write.
//
// A fresh unit-test pass re-arms the latch — it clears `e2eRun` so the gate
// fires again after the *latest* green unit run. Without the re-arm the first
// E2E of a long-lived session keeps the gate satisfied for every later round,
// so a watcher addressing a second round of review comments would change code,
// go unit-green, and end the turn with no fresh E2E.
//
// The re-arm must NOT touch `e2eBlockCount`. Same rule as the pr-terminal
// gate's offer-only reset (applyNextOptionsOffered in prTerminal.ts): only the
// satisfying event rewinds the counter. Unit tests re-run constantly —
// verification passes, review cycles — and when the reset rode along with the
// re-arm, every green run handed the gate a fresh 3-block budget and the
// "release after MAX_E2E_BLOCKS" escape never engaged (observed as ~25 nags in
// one session on changes with no browser surface to test). The counter resets
// only when an E2E run actually registers.
//
// A recorded skip is deliberately NOT cleared by the re-arm: the reasons E2E
// can't run (no app to drive, CLI/library repo, no PR) don't change because
// more unit tests passed, so re-nagging every round is pure noise. The skip
// holds for the rest of the session.
export function applyRecordedRun(state: GuardrailState, run: RecordedRun): GuardrailState {
  let next = state;
  if (run.unitTestPassed) {
    next = { ...next, unitTestsGreen: true, e2eRun: false };
  }
  if (run.e2eRan) {
    next = { ...next, e2eRun: true, e2eBlockCount: 0 };
  }
  if (run.e2eSkipped) {
    next = { ...next, e2eSkipped: true };
  }
  return next;
}

export enum E2eGateAction {
  Block = "block",
  Release = "release",
  None = "none",
}

export interface E2eGateDecision {
  action: E2eGateAction;
  blockCount: number;
}

// Decide what the Stop hook does when the turn is about to end.
//
// - `None`   — no E2E owed (tests weren't green, or a real E2E run was recorded).
// - `Block`  — force the turn to continue so E2E runs; increments blockCount.
// - `Release`— blocked MAX_E2E_BLOCKS times already; stop nagging and allow the
//              turn to end so a genuinely un-runnable E2E can't trap the session.
export function e2eGateDecision(
  state: GuardrailState,
  maxBlocks: number = MAX_E2E_BLOCKS,
): E2eGateDecision {
  const blockCount = state.e2eBlockCount ?? 0;
  if (!shouldRunE2E(state)) return { action: E2eGateAction.None, blockCount: blockCount };
  if (blockCount >= maxBlocks) return { action: E2eGateAction.Release, blockCount: blockCount };
  return { action: E2eGateAction.Block, blockCount: blockCount + 1 };
}
