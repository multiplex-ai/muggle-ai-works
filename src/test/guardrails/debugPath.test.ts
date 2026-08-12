import { describe, it, expect } from "vitest";
import {
  applyDebugEvidence,
  applyDebugSkip,
  applyFailedRun,
  debugGateDecision,
  detectDebugEvidenceRunIds,
  detectFailedRunId,
  isDebugSkipMarker,
  undebuggedFailedRuns,
} from "../../guardrails/debugPath.js";
import { MAX_DEBUG_BLOCKS } from "../../guardrails/constants.js";
import { DebugGateAction, type GuardrailState } from "../../guardrails/types.js";

const baseState = (): GuardrailState => ({ sessionId: "s", prsHandled: [] });

const replayResponse = (status: string, runId: string): string =>
  ["## Test Replay Failed", "", `**Run ID:** ${runId}`, "**Test Script ID:** ts-1", `**Status:** ${status}`].join(
    "\n",
  );

describe("detectFailedRunId", () => {
  it("records the run id of a non-passing local replay", () => {
    expect(
      detectFailedRunId({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
        tool_response: { content: replayResponse("failed", "run-1") },
      }),
    ).toBe("run-1");
  });

  it("records a non-passing generation run too", () => {
    expect(
      detectFailedRunId({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-test-generation",
        tool_response: { content: replayResponse("goal_not_achievable", "run-2") },
      }),
    ).toBe("run-2");
  });

  it("ignores a passing run", () => {
    expect(
      detectFailedRunId({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
        tool_response: { content: replayResponse("passed", "run-3") },
      }),
    ).toBeUndefined();
  });

  it("ignores a tool that is not an execution", () => {
    expect(
      detectFailedRunId({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-run-result-get",
        tool_response: { content: replayResponse("failed", "run-4") },
      }),
    ).toBeUndefined();
  });

  // The host decides the response shape, and an MCP result is structured: a
  // detector that reads one assumed field is dead code everywhere else.
  it.each([
    ["a string content field", { content: replayResponse("failed", "run-5") }],
    ["an array of typed content parts", { content: [{ type: "text", text: replayResponse("failed", "run-5") }] }],
    ["a nested result envelope", { output: { result: { content: replayResponse("failed", "run-5") } } }],
  ])("reads the verdict out of %s", (_label, toolResponse) => {
    expect(
      detectFailedRunId({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
        tool_response: toolResponse as never,
      }),
    ).toBe("run-5");
  });

  it("ignores an execution whose response carries no run id", () => {
    expect(
      detectFailedRunId({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
        tool_response: { content: "Test replay failed: electron exited" },
      }),
    ).toBeUndefined();
  });
});

describe("detectDebugEvidenceRunIds", () => {
  it("accepts a failure-classified telemetry emit naming the run", () => {
    expect(
      detectDebugEvidenceRunIds(
        {
          tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-event-emit",
          tool_input: { eventType: "replay-failure-classified", runId: "run-1" },
        },
        ["run-1", "run-2"],
      ),
    ).toEqual(["run-1"]);
  });

  it("accepts feedback submitted against the run", () => {
    expect(
      detectDebugEvidenceRunIds(
        {
          tool_name: "mcp__plugin_muggle_muggle__muggle-remote-user-feedback-create",
          tool_input: { runId: "run-2", feedback: "clicked the wrong element" },
        },
        ["run-1", "run-2"],
      ),
    ).toEqual(["run-2"]);
  });

  it("accepts a run id that only surfaces in the tool response", () => {
    expect(
      detectDebugEvidenceRunIds(
        {
          tool_name: "mcp__plugin_muggle_muggle__muggle-remote-user-feedback-create",
          tool_input: { testScriptId: "ts-1" },
          tool_response: { content: "Feedback recorded for run run-1" },
        },
        ["run-1"],
      ),
    ).toEqual(["run-1"]);
  });

  it("ignores a tool that is not part of the debug path", () => {
    expect(
      detectDebugEvidenceRunIds(
        { tool_name: "Bash", tool_input: { command: "echo run-1" } },
        ["run-1"],
      ),
    ).toEqual([]);
  });
});

describe("debug skip marker", () => {
  it("clears the run ids the marker names", () => {
    const failed = applyFailedRun(applyFailedRun(baseState(), "run-1"), "run-2");
    const skipped = applyDebugSkip(failed, 'echo "MUGGLE_DEBUG_SKIP: run-1 remote lane, no artifacts"');
    expect(undebuggedFailedRuns(skipped)).toEqual(["run-2"]);
    expect(skipped.debugSkipped).toBeUndefined();
  });

  it("falls back to a session-wide skip when the marker names no recorded run", () => {
    const failed = applyFailedRun(baseState(), "run-1");
    const skipped = applyDebugSkip(failed, 'echo "MUGGLE_DEBUG_SKIP: studio crashed before any run id"');
    expect(skipped.debugSkipped).toBe(true);
    expect(debugGateDecision(skipped).action).toBe(DebugGateAction.None);
  });

  it("ignores a mention that is not the declaration", () => {
    expect(isDebugSkipMarker("git log --grep MUGGLE_DEBUG_SKIP")).toBe(false);
  });

  it("accepts the documented echo form", () => {
    expect(isDebugSkipMarker('echo "MUGGLE_DEBUG_SKIP: run-1 reason"')).toBe(true);
  });
});

describe("debugGateDecision", () => {
  it("does nothing when no run failed", () => {
    expect(debugGateDecision(baseState()).action).toBe(DebugGateAction.None);
  });

  it("blocks while a failed run has no debug evidence", () => {
    const decision = debugGateDecision(applyFailedRun(baseState(), "run-1"));
    expect(decision.action).toBe(DebugGateAction.Block);
    expect(decision.blockCount).toBe(1);
    expect(decision.undebugged).toEqual(["run-1"]);
  });

  it("clears once evidence names the run", () => {
    const failed = applyFailedRun(baseState(), "run-1");
    expect(debugGateDecision(applyDebugEvidence(failed, ["run-1"])).action).toBe(DebugGateAction.None);
  });

  it("releases after the reminder ceiling", () => {
    const state = { ...applyFailedRun(baseState(), "run-1"), debugBlockCount: MAX_DEBUG_BLOCKS };
    expect(debugGateDecision(state).action).toBe(DebugGateAction.Release);
  });

  it("records a failed run once", () => {
    const once = applyFailedRun(baseState(), "run-1");
    expect(applyFailedRun(once, "run-1")).toBe(once);
  });
});
