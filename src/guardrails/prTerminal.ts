import { PrTerminalGateAction, PrTerminalVerdict } from "./types.js";
import type { GuardrailState, HookInput, PrTerminalEvent, PrTerminalGateDecision } from "./types.js";
import {
  GH_PR_MERGED_LINE,
  GH_PR_CLOSED_LINE,
  PR_MONITOR_TERMINAL_LINE,
  MAX_PR_TERMINAL_BLOCKS,
} from "./constants.js";

// gh writes its success line to stderr, the monitor exit line arrives on
// stdout/output, and a replayed Monitor notification may carry it in content —
// scan all four.
export function detectPrTerminal(input: HookInput): PrTerminalEvent | null {
  if (input.tool_name !== "Bash" && input.tool_name !== "Monitor") return null;
  const response = input.tool_response;
  const haystack = [response?.stdout, response?.stderr, response?.output, response?.content]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  const mergedMatch = haystack.match(GH_PR_MERGED_LINE);
  if (mergedMatch) {
    return { prNumber: Number(mergedMatch[1]), verdict: PrTerminalVerdict.Merged };
  }
  const closedMatch = haystack.match(GH_PR_CLOSED_LINE);
  if (closedMatch) {
    return { prNumber: Number(closedMatch[1]), verdict: PrTerminalVerdict.Closed };
  }
  const monitorMatch = haystack.match(PR_MONITOR_TERMINAL_LINE);
  if (monitorMatch) {
    return {
      prNumber: Number(monitorMatch[1]),
      verdict: monitorMatch[2] === "MERGED" ? PrTerminalVerdict.Merged : PrTerminalVerdict.Closed,
    };
  }
  return null;
}

// Arm the handoff for a newly terminal PR. Returns the same reference when the
// PR is already pending or already handled so the caller can skip the write and
// the repeat nudge — the same terminal line can resurface later in the session
// (a log tail, a replayed monitor notification) and must not re-arm a gate the
// offer already cleared.
export function applyPrTerminalDetected(state: GuardrailState, prNumber: number): GuardrailState {
  const pending = state.terminalPending ?? [];
  const handled = state.terminalHandled ?? [];
  if (pending.includes(prNumber) || handled.includes(prNumber)) return state;
  return { ...state, terminalPending: [...pending, prNumber] };
}

// The ONLY exit: an AskUserQuestion call while a terminal PR is pending. Moves
// the pending PRs to handled and resets the block counter. Nothing else —
// not a passing unit test, not a tick, not another Bash call — may clear the
// pending set or rewind the counter: any other reset path lets routine
// activity turn the 3-block cap into an unbounded nag loop.
export function applyNextOptionsOffered(state: GuardrailState): GuardrailState {
  const pending = state.terminalPending ?? [];
  if (pending.length === 0) return state;
  return {
    ...state,
    terminalPending: [],
    terminalHandled: [...(state.terminalHandled ?? []), ...pending],
    terminalBlockCount: 0,
  };
}

// Decide what the Stop hook does when a terminal PR's handoff is still owed.
//
// - `None`    — nothing pending (no terminal PR, or the offer already ran).
// - `Block`   — refuse the turn end so the handoff runs; increments blockCount.
// - `Release` — blocked MAX_PR_TERMINAL_BLOCKS times already; allow the turn to
//               end so an un-offerable situation can't trap the session. The
//               release is unconditional and the counter only ever moves up
//               (here) or back to zero (applyNextOptionsOffered).
export function prTerminalGateDecision(
  state: GuardrailState,
  maxBlocks: number = MAX_PR_TERMINAL_BLOCKS,
): PrTerminalGateDecision {
  const blockCount = state.terminalBlockCount ?? 0;
  if ((state.terminalPending ?? []).length === 0) {
    return { action: PrTerminalGateAction.None, blockCount: blockCount };
  }
  if (blockCount >= maxBlocks) {
    return { action: PrTerminalGateAction.Release, blockCount: blockCount };
  }
  return { action: PrTerminalGateAction.Block, blockCount: blockCount + 1 };
}
