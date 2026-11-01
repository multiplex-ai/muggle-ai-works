import { callFailed } from "./callOutcome.js";
import {
  ACCEPTANCE_REPORT_MARKERS,
  ACCEPTANCE_TESTER_SUBAGENT_TYPE,
  DELEGATED_E2E_WINDOW_MS,
  SUBAGENT_DISPATCH_TOOL_NAMES,
} from "./constants.js";
import { extractPrUrls } from "./prUrls.js";
import type { E2eDelegation, GuardrailState, HookInput } from "./types.js";

function carriesAcceptanceReport(input: HookInput): boolean {
  const response = JSON.stringify(input.tool_response ?? "");
  return ACCEPTANCE_REPORT_MARKERS.some((marker) => response.includes(marker));
}

/**
 * The PRs named by an acceptance-tester this call launched into the background, or null when it launched none.
 *
 * A foreground dispatch returns with the agent's report already in hand, so it
 * is over by the time this hook sees it and is never recorded.
 *
 * Output shape: `["https://github.com/o/r/pull/7"]` — empty when the brief predates its PR.
 */
export function detectBackgroundAcceptanceDispatch(input: HookInput): string[] | null {
  if (!(SUBAGENT_DISPATCH_TOOL_NAMES as readonly string[]).includes(input.tool_name ?? "")) return null;
  if (!ACCEPTANCE_TESTER_SUBAGENT_TYPE.test(input.tool_input?.subagent_type ?? "")) return null;
  if (callFailed(input) || carriesAcceptanceReport(input)) return null;
  return extractPrUrls(input.tool_input?.prompt ?? "");
}

function liveDelegations(state: GuardrailState, now: number): E2eDelegation[] {
  return (state.e2eDelegations ?? []).filter((delegation) => now - delegation.dispatchedAt < DELEGATED_E2E_WINDOW_MS);
}

/** Record a background dispatch, dropping any whose window has already closed. */
export function applyE2eDelegation(state: GuardrailState, delegation: E2eDelegation): GuardrailState {
  return { ...state, e2eDelegations: [...liveDelegations(state, delegation.dispatchedAt), delegation] };
}

/** Whether an acceptance-tester launched into the background may still be running its browser. */
export function isE2eDelegationInFlight(state: GuardrailState, now: number): boolean {
  return liveDelegations(state, now).length > 0;
}

/**
 * The PRs left once those awaiting their own background run are set aside.
 *
 * A PR whose run is still in flight is not owed a walkthrough or a watch yet;
 * every other PR is, whatever else is running — one change's run never covers
 * another's PR.
 */
export function withoutDelegatedPrs(prUrls: string[], state: GuardrailState, now: number): string[] {
  const delegatedPrUrls = new Set(liveDelegations(state, now).flatMap((delegation) => delegation.prUrls));
  return prUrls.filter((prUrl) => !delegatedPrUrls.has(prUrl));
}
