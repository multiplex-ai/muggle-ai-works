import type { GuardrailState } from "./types.js";

export const MAX_E2E_BLOCKS = 3;

export function shouldRunE2E(state: GuardrailState): boolean {
  return state.unitTestsGreen === true && state.e2eRun !== true;
}

export type E2eGateAction = "block" | "release" | "none";

export interface E2eGateDecision {
  action: E2eGateAction;
  blockCount: number;
}

// Decide what the Stop hook does when the turn is about to end.
//
// - `none`   — no E2E owed (tests weren't green, or a real E2E run was recorded).
// - `block`  — force the turn to continue so E2E runs; increments blockCount.
// - `release`— blocked MAX_E2E_BLOCKS times already; stop nagging and allow the
//              turn to end so a genuinely un-runnable E2E can't trap the session.
export function e2eGateDecision(
  state: GuardrailState,
  maxBlocks: number = MAX_E2E_BLOCKS,
): E2eGateDecision {
  const blockCount = state.e2eBlockCount ?? 0;
  if (!shouldRunE2E(state)) return { action: "none", blockCount: blockCount };
  if (blockCount >= maxBlocks) return { action: "release", blockCount: blockCount };
  return { action: "block", blockCount: blockCount + 1 };
}
