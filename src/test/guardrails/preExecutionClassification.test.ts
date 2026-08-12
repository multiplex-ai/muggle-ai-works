import { describe, it, expect } from "vitest";
import {
  applyClassificationSkip,
  applyClassifiedTestCase,
  classificationGateDecision,
  detectClassifiedTestCaseId,
  isClassificationSkipMarker,
  resolveExecutionTargetTestCaseId,
} from "../../guardrails/preExecutionClassification.js";
import { ANY_TEST_CASE, MUGGLE_TEST_SKILL_NAME } from "../../guardrails/constants.js";
import type { GuardrailState } from "../../guardrails/types.js";

const routerState = (): GuardrailState => ({
  sessionId: "s",
  prsHandled: [],
  lastInvokedSkillName: MUGGLE_TEST_SKILL_NAME,
});

const emitInput = (eventType: string, testCaseId?: string) => ({
  tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-event-emit",
  tool_input: { eventType: eventType, testCaseId: testCaseId },
});

describe("detectClassifiedTestCaseId", () => {
  it("records the test case of a pre-execution-classification emit", () => {
    expect(detectClassifiedTestCaseId(emitInput("pre-execution-classification", "tc-1"))).toBe("tc-1");
  });

  it("falls back to the any-test-case wildcard when the emit carries no test case", () => {
    expect(detectClassifiedTestCaseId(emitInput("pre-execution-classification"))).toBe(ANY_TEST_CASE);
  });

  it("ignores a post-failure telemetry emit", () => {
    expect(detectClassifiedTestCaseId(emitInput("replay-failure-classified", "tc-1"))).toBeUndefined();
  });

  it("ignores an emit from another tool that happens to carry the event type", () => {
    expect(
      detectClassifiedTestCaseId({
        tool_name: "Bash",
        tool_input: { eventType: "pre-execution-classification", testCaseId: "tc-1" },
      }),
    ).toBeUndefined();
  });
});

describe("resolveExecutionTargetTestCaseId", () => {
  it("reads the test case of a generation run", () => {
    expect(
      resolveExecutionTargetTestCaseId({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-test-generation",
        tool_input: { testCase: { id: "tc-1" } },
      }),
    ).toBe("tc-1");
  });

  it("reads the test case a replay's script belongs to", () => {
    expect(
      resolveExecutionTargetTestCaseId({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
        tool_input: { testScript: { id: "ts-9", testCaseId: "tc-2" } },
      }),
    ).toBe("tc-2");
  });

  it("returns nothing for a tool that is not an execution", () => {
    expect(
      resolveExecutionTargetTestCaseId({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-run-result-get",
        tool_input: { testCase: { id: "tc-1" } },
      }),
    ).toBeUndefined();
  });
});

describe("classificationGateDecision", () => {
  const generationInput = (testCaseId: string) => ({
    tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-test-generation",
    tool_input: { testCase: { id: testCaseId } },
  });

  it("denies an unclassified test case", () => {
    const decision = classificationGateDecision(routerState(), generationInput("tc-1"));
    expect(decision.deny).toBe(true);
    expect(decision.testCaseId).toBe("tc-1");
  });

  it("allows a test case classified earlier this session", () => {
    const state = applyClassifiedTestCase(routerState(), "tc-1");
    expect(classificationGateDecision(state, generationInput("tc-1")).deny).toBe(false);
  });

  it("allows every test case once an unkeyed classification emit registered", () => {
    const state = applyClassifiedTestCase(routerState(), ANY_TEST_CASE);
    expect(classificationGateDecision(state, generationInput("tc-9")).deny).toBe(false);
  });

  it("stays out of the way of skills that have no classification step", () => {
    const state: GuardrailState = {
      sessionId: "s",
      prsHandled: [],
      lastInvokedSkillName: "muggle-test-feature-local",
    };
    expect(classificationGateDecision(state, generationInput("tc-1")).deny).toBe(false);
  });

  it("stays out of the way when no skill was invoked at all", () => {
    const state: GuardrailState = { sessionId: "s", prsHandled: [] };
    expect(classificationGateDecision(state, generationInput("tc-1")).deny).toBe(false);
  });

  it("honours the recorded skip", () => {
    const state = applyClassificationSkip(routerState(), true);
    expect(classificationGateDecision(state, generationInput("tc-1")).deny).toBe(false);
  });

  it("allows an execution whose test case cannot be resolved rather than trapping the run", () => {
    const decision = classificationGateDecision(routerState(), {
      tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
      tool_input: {},
    });
    expect(decision.deny).toBe(false);
  });
});

describe("classification skip marker", () => {
  it("accepts the documented echo form", () => {
    expect(isClassificationSkipMarker('echo "MUGGLE_CLASSIFY_SKIP: single user-picked case"')).toBe(true);
  });

  it("ignores a mention that is not the declaration", () => {
    expect(isClassificationSkipMarker("rg MUGGLE_CLASSIFY_SKIP src/")).toBe(false);
  });
});
