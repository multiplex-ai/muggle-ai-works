import {
  ANY_TEST_CASE,
  MUGGLE_EVENT_EMIT_TOOL,
  MUGGLE_EXECUTION_TOOL,
  MUGGLE_TEST_SKILL_NAME,
  PRE_EXECUTION_CLASSIFICATION_EVENT,
} from "./constants.js";
import type { ClassificationGateDecision, GuardrailState, HookInput } from "./types.js";

// muggle-test Step 6f classifies each selected test case replay-vs-regen before
// anything executes, and that classification is what calls
// `muggle-remote-test-script-list` — the only place the run learns that this
// test case has never passed, or has failed N times running. Skipped, the
// session spends ~5 minutes of real browser time to rediscover it. Nothing
// enforced the step, so it was routinely skipped.
const CLASSIFICATION_SKIP_MARKER = /^\s*echo\s+["']?MUGGLE_CLASSIFY_SKIP\b/;

/** The test case a Step 6f classification emit covers, or the any-test-case wildcard when the emit named none. */
export function detectClassifiedTestCaseId(input: HookInput): string | undefined {
  if (!MUGGLE_EVENT_EMIT_TOOL.test(input.tool_name ?? "")) return undefined;
  if (input.tool_input?.eventType !== PRE_EXECUTION_CLASSIFICATION_EVENT) return undefined;
  return input.tool_input?.testCaseId ?? ANY_TEST_CASE;
}

/** Record a classified test case, returning the same reference when it was already recorded. */
export function applyClassifiedTestCase(state: GuardrailState, testCaseId: string): GuardrailState {
  if ((state.classifiedTestCaseIds ?? []).includes(testCaseId)) return state;
  return { ...state, classifiedTestCaseIds: [...(state.classifiedTestCaseIds ?? []), testCaseId] };
}

/**
 * The test case an execution call is about to spend a browser run on.
 *
 * Generation carries the test case directly; replay carries the script, which
 * names the test case it was generated from.
 */
export function resolveExecutionTargetTestCaseId(input: HookInput): string | undefined {
  if (!MUGGLE_EXECUTION_TOOL.test(input.tool_name ?? "")) return undefined;
  return input.tool_input?.testCase?.id ?? input.tool_input?.testScript?.testCaseId;
}

/** Whether a Bash command is the explicit classification-skip declaration. */
export function isClassificationSkipMarker(command: string): boolean {
  return CLASSIFICATION_SKIP_MARKER.test(command);
}

/** Record a classification skip, returning the same reference when nothing changed. */
export function applyClassificationSkip(state: GuardrailState, skipped: boolean): GuardrailState {
  if (!skipped || state.classificationSkipped === true) return state;
  return { ...state, classificationSkipped: true };
}

/**
 * Decide whether an execution call may proceed unclassified.
 *
 * Scoped to the skill that owns Step 6f. The other skills that drive the same
 * execution tools (`muggle-test-feature-local`, `muggle-browser-task`) run
 * against a single user-picked target and are told to skip classification, so
 * gating them would deny legitimate work.
 *
 * Fails open on an execution whose test case can't be read: an unresolvable
 * target is a hook blind spot, not evidence the step was skipped.
 */
export function classificationGateDecision(
  state: GuardrailState,
  input: HookInput,
): ClassificationGateDecision {
  if (state.lastInvokedSkillName !== MUGGLE_TEST_SKILL_NAME) return { deny: false };
  if (state.classificationSkipped === true) return { deny: false };
  const testCaseId = resolveExecutionTargetTestCaseId(input);
  if (!testCaseId) return { deny: false };
  const classified = state.classifiedTestCaseIds ?? [];
  if (classified.includes(ANY_TEST_CASE) || classified.includes(testCaseId)) return { deny: false };
  return { deny: true, testCaseId: testCaseId };
}
