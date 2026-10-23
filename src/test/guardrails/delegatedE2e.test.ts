import { describe, it, expect } from "vitest";
import {
  applyE2eDelegation,
  detectBackgroundAcceptanceDispatch,
  isE2eDelegationInFlight,
  withoutDelegatedPrs,
} from "../../guardrails/delegatedE2e";
import { DELEGATED_E2E_WINDOW_MS } from "../../guardrails/constants";
import { debugGateDecision } from "../../guardrails/debugPath";
import { e2eGateDecision, E2eGateAction } from "../../guardrails/shouldRunE2E";
import { DebugGateAction, type GuardrailState, type HookInput } from "../../guardrails/types";

const PR_A = "https://github.com/o/r/pull/1";
const PR_B = "https://github.com/o/other/pull/2";
const MR_C = "https://gitlab.com/g/p/-/merge_requests/3";
const DISPATCHED_AT = 1_000_000;

function dispatch(overrides: Partial<HookInput> = {}, prompt = `Run E2E for ${PR_A}`): HookInput {
  return {
    session_id: "s",
    tool_name: "Agent",
    tool_input: { subagent_type: "muggle:acceptance-tester", prompt: prompt },
    tool_response: { output: "Async agent launched successfully." },
    ...overrides,
  };
}

function delegatedState(prUrls: string[], overrides: Partial<GuardrailState> = {}): GuardrailState {
  const base: GuardrailState = { sessionId: "s", prsHandled: [PR_A, PR_B], ...overrides };
  return applyE2eDelegation(base, { dispatchedAt: DISPATCHED_AT, prUrls: prUrls });
}

describe("detectBackgroundAcceptanceDispatch", () => {
  it("records a background acceptance-tester and the PRs its brief names, once each", () => {
    const prompt = `Change A: ${PR_A}/files, again ${PR_A}, sibling ${MR_C}`;
    expect(detectBackgroundAcceptanceDispatch(dispatch({}, prompt))).toEqual([PR_A, MR_C]);
  });

  it("records a brief that predates its PR with no PRs at all", () => {
    expect(detectBackgroundAcceptanceDispatch(dispatch({}, "Run Stage 6 for slug fix-login"))).toEqual([]);
  });

  it("accepts the bare agent name and the older Task tool", () => {
    const bare = dispatch({ tool_name: "Task", tool_input: { subagent_type: "acceptance-tester", prompt: PR_A } });
    expect(detectBackgroundAcceptanceDispatch(bare)).toEqual([PR_A]);
  });

  it("ignores every other agent, and tools that dispatch none", () => {
    const builder = dispatch({ tool_input: { subagent_type: "muggle:visual-walkthrough-builder", prompt: PR_A } });
    expect(detectBackgroundAcceptanceDispatch(builder)).toBeNull();
    expect(detectBackgroundAcceptanceDispatch(dispatch({ tool_name: "Bash" }))).toBeNull();
  });

  it("ignores a foreground dispatch, which returned with the agent's report and is already over", () => {
    const finished = dispatch({ tool_response: { output: "## Test Summary\n- **Verdict:** PASS" } });
    expect(detectBackgroundAcceptanceDispatch(finished)).toBeNull();
  });

  it("ignores a dispatch the host rejected", () => {
    expect(detectBackgroundAcceptanceDispatch(dispatch({ tool_response: { output: '"isError": true' } }))).toBeNull();
  });
});

describe("delegation window", () => {
  it("counts a dispatch as in flight until the window closes", () => {
    const state = delegatedState([]);
    expect(isE2eDelegationInFlight(state, DISPATCHED_AT + DELEGATED_E2E_WINDOW_MS - 1)).toBe(true);
    expect(isE2eDelegationInFlight(state, DISPATCHED_AT + DELEGATED_E2E_WINDOW_MS)).toBe(false);
    expect(isE2eDelegationInFlight({ sessionId: "s", prsHandled: [] }, DISPATCHED_AT)).toBe(false);
  });

  it("drops closed delegations when a new one is recorded", () => {
    const later = DISPATCHED_AT + DELEGATED_E2E_WINDOW_MS + 1;
    const next = applyE2eDelegation(delegatedState([PR_A]), { dispatchedAt: later, prUrls: [PR_B] });
    expect(next.e2eDelegations).toEqual([{ dispatchedAt: later, prUrls: [PR_B] }]);
  });

  it("sets aside only the PRs whose own run is in flight", () => {
    const state = delegatedState([PR_A]);
    expect(withoutDelegatedPrs([PR_A, PR_B], state, DISPATCHED_AT + 1)).toEqual([PR_B]);
    expect(withoutDelegatedPrs([PR_A, PR_B], state, DISPATCHED_AT + DELEGATED_E2E_WINDOW_MS)).toEqual([PR_A, PR_B]);
  });
});

describe("gates while a background run is in flight", () => {
  it("holds the E2E gate off, so the main session is never steered into a second browser run", () => {
    const owed = delegatedState([], { unitTestsGreen: true });
    expect(e2eGateDecision(owed, undefined, DISPATCHED_AT + 1).action).toBe(E2eGateAction.None);
    expect(e2eGateDecision(owed, undefined, DISPATCHED_AT + DELEGATED_E2E_WINDOW_MS).action).toBe(E2eGateAction.Block);
  });

  it("holds the debug-path gate off while the agent debugs its own failed runs", () => {
    const failed = delegatedState([], { failedRuns: ["run-1"] });
    expect(debugGateDecision(failed, undefined, DISPATCHED_AT + 1).action).toBe(DebugGateAction.None);
    expect(debugGateDecision(failed, undefined, DISPATCHED_AT + DELEGATED_E2E_WINDOW_MS).action).toBe(
      DebugGateAction.Block,
    );
  });
});
