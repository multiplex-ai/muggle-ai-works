import type { GuardrailState } from "./types.js";

export const MAX_E2E_BLOCKS = 3;

export function shouldRunE2E(state: GuardrailState): boolean {
  return state.unitTestsGreen === true && state.e2eRun !== true;
}

export interface RecordedRun {
  unitTestPassed?: boolean;
  e2eRan?: boolean;
}

// Fold a recorded test run into the gate state, returning the same reference
// when nothing was recorded so the caller can skip a redundant write.
//
// A fresh unit-test pass re-arms the latch — it clears `e2eRun` and the block
// counter so the gate fires again after the *latest* green unit run. Without
// the reset the first E2E of a long-lived session keeps the gate satisfied for
// every later round, so a watcher addressing a second round of review comments
// would change code, go unit-green, and end the turn with no fresh E2E.
export function applyRecordedRun(state: GuardrailState, run: RecordedRun): GuardrailState {
  let next = state;
  if (run.unitTestPassed) {
    next = { ...next, unitTestsGreen: true, e2eRun: false, e2eBlockCount: 0 };
  }
  if (run.e2eRan) {
    next = { ...next, e2eRun: true };
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
