import { describe, it, expect } from "vitest";
import {
  detectPrTerminal,
  detectPrReopened,
  applyPrTerminalDetected,
  applyPrReopened,
  applyNextOptionsOffered,
  prTerminalGateDecision,
} from "../../guardrails/prTerminal";
import { PrTerminalGateAction, PrTerminalVerdict, type GuardrailState } from "../../guardrails/types";
import { MAX_PR_TERMINAL_BLOCKS } from "../../guardrails/constants";
import { applyRecordedRun } from "../../guardrails/shouldRunE2E";

describe("detectPrTerminal", () => {
  it("detects a gh pr merge success line (gh writes it to stderr)", () => {
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 341 --squash" },
        tool_response: { stdout: "", stderr: "✓ Squashed and merged pull request #341 (feat: thing)\n" },
      }),
    ).toEqual({ prNumber: 341, verdict: PrTerminalVerdict.Merged });
  });

  it("detects the plain merge and owner/repo-prefixed shapes", () => {
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_response: { stderr: "✓ Merged pull request #12 (fix: y)" },
      }),
    ).toEqual({ prNumber: 12, verdict: PrTerminalVerdict.Merged });
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_response: { stderr: "✓ Rebased and merged pull request multiplex-ai/muggle-ai-works#98 (x)" },
      }),
    ).toEqual({ prNumber: 98, verdict: PrTerminalVerdict.Merged });
  });

  it("detects a gh pr close success line", () => {
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_input: { command: "gh pr close 55" },
        tool_response: { stderr: "✓ Closed pull request multiplex-ai/muggle-ai-ui#55 (stale spike)\n" },
      }),
    ).toEqual({ prNumber: 55, verdict: PrTerminalVerdict.Closed });
  });

  it("detects the watch monitor's TERMINAL exit line, both verdicts", () => {
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_response: { stdout: "tick 41 ok\nTERMINAL pr=331: MERGED\n" },
      }),
    ).toEqual({ prNumber: 331, verdict: PrTerminalVerdict.Merged });
    expect(
      detectPrTerminal({
        tool_name: "Monitor",
        tool_response: { content: "TERMINAL pr=45: CLOSED" },
      }),
    ).toEqual({ prNumber: 45, verdict: PrTerminalVerdict.Closed });
  });

  it("ignores state metadata in JSON fetches — a PR state query is not a terminal event", () => {
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_input: { command: "gh pr view 341 --json state,mergedAt" },
        tool_response: { stdout: '{"state":"MERGED","mergedAt":"2026-07-22T10:00:00Z"}' },
      }),
    ).toBeNull();
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_response: { stdout: '{ "state": "CLOSED" }' },
      }),
    ).toBeNull();
  });

  it("ignores gh pr view human output for an already-merged PR", () => {
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_response: {
          stdout: "feat: thing multiplex-ai/muggle-ai-works#341\nMerged • stan4git merged 3 commits into master\n",
        },
      }),
    ).toBeNull();
  });

  it("ignores git's merge-commit subject in a log", () => {
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_input: { command: "git log --oneline -5" },
        tool_response: { stdout: "a4b41da Merge pull request #331 from feat/watch-monitor\n" },
      }),
    ).toBeNull();
  });

  it("ignores non-Bash, non-Monitor tools", () => {
    expect(
      detectPrTerminal({
        tool_name: "Edit",
        tool_response: { stdout: "✓ Merged pull request #341 (x)" },
      }),
    ).toBeNull();
  });
});

describe("applyPrTerminalDetected / applyNextOptionsOffered", () => {
  const base: GuardrailState = { sessionId: "s", prsHandled: [] };

  it("arms a newly terminal PR and dedupes repeats", () => {
    const armed = applyPrTerminalDetected(base, 341);
    expect(armed.terminalPending).toEqual([341]);
    expect(applyPrTerminalDetected(armed, 341)).toBe(armed);
  });

  it("accumulates distinct PRs", () => {
    const two = applyPrTerminalDetected(applyPrTerminalDetected(base, 1), 2);
    expect(two.terminalPending).toEqual([1, 2]);
  });

  it("the offer clears pending, records handled, and resets the counter", () => {
    const armed = { ...base, terminalPending: [341, 12], terminalBlockCount: 2 };
    const cleared = applyNextOptionsOffered(armed);
    expect(cleared.terminalPending).toEqual([]);
    expect(cleared.terminalHandled).toEqual([341, 12]);
    expect(cleared.terminalBlockCount).toBe(0);
  });

  it("a handled PR never re-arms — a replayed terminal line after the offer stays quiet", () => {
    const afterOffer = applyNextOptionsOffered({ ...base, terminalPending: [341] });
    expect(applyPrTerminalDetected(afterOffer, 341)).toBe(afterOffer);
  });

  it("the offer is a no-op when nothing is pending", () => {
    expect(applyNextOptionsOffered(base)).toBe(base);
    const emptyPending: GuardrailState = { ...base, terminalPending: [] };
    expect(applyNextOptionsOffered(emptyPending)).toBe(emptyPending);
  });
});

describe("prTerminalGateDecision", () => {
  const pending: GuardrailState = { sessionId: "s", prsHandled: [], terminalPending: [341] };

  it("does nothing when no terminal PR is pending", () => {
    expect(prTerminalGateDecision({ sessionId: "s", prsHandled: [] }).action).toBe(PrTerminalGateAction.None);
    expect(
      prTerminalGateDecision({ sessionId: "s", prsHandled: [], terminalPending: [], terminalHandled: [341] }).action,
    ).toBe(PrTerminalGateAction.None);
  });

  it("blocks and increments the count while the offer is owed", () => {
    expect(prTerminalGateDecision(pending)).toEqual({ action: PrTerminalGateAction.Block, blockCount: 1 });
    expect(prTerminalGateDecision({ ...pending, terminalBlockCount: 2 })).toEqual({
      action: PrTerminalGateAction.Block,
      blockCount: 3,
    });
  });

  it("releases unconditionally after MAX_PR_TERMINAL_BLOCKS blocks", () => {
    const decision = prTerminalGateDecision({ ...pending, terminalBlockCount: MAX_PR_TERMINAL_BLOCKS });
    expect(decision.action).toBe(PrTerminalGateAction.Release);
    expect(decision.blockCount).toBe(MAX_PR_TERMINAL_BLOCKS);
  });

  it("walks pending → block ×3 → release", () => {
    let state = { ...pending };
    for (let expected = 1; expected <= MAX_PR_TERMINAL_BLOCKS; expected++) {
      const decision = prTerminalGateDecision(state);
      expect(decision).toEqual({ action: PrTerminalGateAction.Block, blockCount: expected });
      state = { ...state, terminalBlockCount: decision.blockCount };
    }
    expect(prTerminalGateDecision(state).action).toBe(PrTerminalGateAction.Release);
  });

  it("the offer clears an armed gate", () => {
    const cleared = applyNextOptionsOffered({ ...pending, terminalBlockCount: 2 });
    expect(prTerminalGateDecision(cleared).action).toBe(PrTerminalGateAction.None);
  });

  it("a passing unit test never rewinds the counter (the e2e gate's reset bug must not recur)", () => {
    const blockedTwice = { ...pending, terminalBlockCount: 2 };
    const afterUnitPass = applyRecordedRun(blockedTwice, { unitTestPassed: true });
    expect(afterUnitPass.terminalBlockCount).toBe(2);
    expect(afterUnitPass.terminalPending).toEqual([341]);
    expect(prTerminalGateDecision(afterUnitPass)).toEqual({ action: PrTerminalGateAction.Block, blockCount: 3 });
  });
});

describe("detectPrReopened", () => {
  const bash = (stderr: string): Parameters<typeof detectPrReopened>[0] => ({
    tool_name: "Bash",
    tool_response: { stderr: stderr },
  });

  it("reads the pull-request number off a gh pr reopen success line", () => {
    expect(detectPrReopened(bash("✓ Reopened pull request multiplex-ai/muggle-ai-works#369 (fix: x)\n"))).toBe(369);
    expect(detectPrReopened(bash("✓ Reopened pull request #12 (title)\n"))).toBe(12);
  });

  it("ignores a close, a merge, and a routine status fetch", () => {
    expect(detectPrReopened(bash("✓ Closed pull request o/r#12 (stale)\n"))).toBeNull();
    expect(detectPrReopened(bash("✓ Merged pull request #12 (feat)\n"))).toBeNull();
    expect(detectPrReopened({ tool_name: "Bash", tool_response: { stdout: '{"state":"OPEN"}' } })).toBeNull();
  });

  it("ignores non-Bash tools", () => {
    expect(detectPrReopened({ tool_name: "Monitor", tool_response: { stdout: "✓ Reopened pull request #12 (t)" } })).toBeNull();
  });
});

describe("applyPrReopened", () => {
  const base = (over: Partial<GuardrailState> = {}): GuardrailState => ({
    sessionId: "s",
    prsHandled: [],
    ...over,
  });

  // The transient close: closing and reopening re-fires a lost workflow trigger
  // and re-syncs a head left at the base branch. The change is open again, so no
  // post-merge handoff is owed and the Stop gate must not hold the turn.
  it("drops a reopened number from terminalPending so the gate stops blocking", () => {
    const pending = base({ terminalPending: [369] });
    const next = applyPrReopened(pending, 369);
    expect(next.terminalPending).toEqual([]);
    expect(prTerminalGateDecision(next).action).toBe(PrTerminalGateAction.None);
  });

  it("drops it from terminalHandled too, so a later genuine close re-arms", () => {
    const handled = base({ terminalHandled: [369] });
    const reopened = applyPrReopened(handled, 369);
    expect(reopened.terminalHandled).toEqual([]);
    const closedAgain = applyPrTerminalDetected(reopened, 369);
    expect(closedAgain.terminalPending).toEqual([369]);
  });

  it("never rewinds the block counter — only the offer does", () => {
    const blocked = base({ terminalPending: [369], terminalBlockCount: 2 });
    expect(applyPrReopened(blocked, 369).terminalBlockCount).toBe(2);
  });

  it("leaves other PRs' pending state untouched", () => {
    const twoPending = base({ terminalPending: [341, 369] });
    expect(applyPrReopened(twoPending, 369).terminalPending).toEqual([341]);
  });

  it("returns the same reference when the number was never terminal", () => {
    const state = base({ terminalPending: [341] });
    expect(applyPrReopened(state, 369)).toBe(state);
  });
});

describe("forge lines are only evidence when this call produced them", () => {
  const MERGE_LINE = "91:  [\"a merge success line\", outputPayload(\"[ok] Merged pull request o/r#341 (feat: thing)\")],";

  // This is not hypothetical: grepping a test fixture for the phrase armed a
  // post-merge handoff for PR #341 twice while this very change was being
  // written, and held the turn open until the state was edited by hand.
  it("ignores a merge line a grep merely printed", () => {
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_input: { command: "grep -n 'Merged' src/test/guardrails/hook-execution.test.ts" },
        tool_response: { stdout: MERGE_LINE.replace("[ok]", "✓") },
      }),
    ).toBeNull();
  });

  it("ignores a close line a file read merely printed", () => {
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_input: { command: "sed -n '1,50p' src/test/guardrails/prTerminal.test.ts" },
        tool_response: { stdout: "✓ Closed pull request o/r#12 (stale)" },
      }),
    ).toBeNull();
  });

  it("ignores a reopen line a grep merely printed", () => {
    expect(
      detectPrReopened({
        tool_name: "Bash",
        tool_input: { command: "cat src/guardrails/constants.ts" },
        tool_response: { stdout: "✓ Reopened pull request o/r#369 (gate fix)" },
      }),
    ).toBeNull();
  });

  it("still accepts the line from the command that produced it", () => {
    expect(
      detectPrTerminal({
        tool_name: "Bash",
        tool_input: { command: "gh pr merge 341 --squash" },
        tool_response: { stderr: "✓ Merged pull request o/r#341 (feat: thing)" },
      }),
    ).toEqual({ prNumber: 341, verdict: PrTerminalVerdict.Merged });
  });

  // The watcher's own exit line is machine-generated and reaches the session
  // through the monitor, not a command the model chose to run.
  it("still accepts the monitor's terminal line, which carries no command", () => {
    expect(
      detectPrTerminal({
        tool_name: "Monitor",
        tool_response: { stdout: "TERMINAL pr=331: MERGED" },
      }),
    ).toEqual({ prNumber: 331, verdict: PrTerminalVerdict.Merged });
  });
});
