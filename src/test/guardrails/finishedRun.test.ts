import { describe, it, expect } from "vitest";
import { detectFinishedRun } from "../../guardrails/finishedRun";
import { E2eProgressStatus } from "../../pr-walkthrough/types";

const REPLAY_TOOL = "mcp__plugin_muggle_muggle__muggle-local-execute-replay";
const GENERATION_TOOL = "mcp__plugin_muggle_muggle__muggle-local-execute-test-generation";

const rendered = (status: string, viewUrl?: string): unknown => [
  {
    type: "text",
    text: [
      `## Test Replay ${status === "passed" ? "Successful" : "Failed"}`,
      "",
      "**Run ID:** run-1",
      `**Status:** ${status}`,
      ...(viewUrl ? [`**View URL:** ${viewUrl}`] : []),
    ].join("\n"),
  },
];

describe("detectFinishedRun", () => {
  it("reads a replay's case, verdict, and dashboard link", () => {
    expect(
      detectFinishedRun({
        tool_name: REPLAY_TOOL,
        tool_input: { testScript: { testCaseId: "tc-1", name: "Login script" } },
        tool_response: { content: rendered("passed", "https://www.muggle-ai.com/run/1") },
      }),
    ).toEqual({
      testCaseId: "tc-1",
      title: "Login script",
      status: E2eProgressStatus.Passed,
      viewUrl: "https://www.muggle-ai.com/run/1",
    });
  });

  it("reads a generation's case title and counts any other verdict as failed", () => {
    expect(
      detectFinishedRun({
        tool_name: GENERATION_TOOL,
        tool_input: { testCase: { id: "tc-2", title: "Checkout" } },
        tool_response: { content: rendered("failed") },
      }),
    ).toEqual({ testCaseId: "tc-2", title: "Checkout", status: E2eProgressStatus.Failed });
  });

  it("ignores a call refused before any run started, and other tools", () => {
    expect(
      detectFinishedRun({
        tool_name: REPLAY_TOOL,
        tool_input: { testScript: { testCaseId: "tc-1" } },
        tool_response: { content: "Test replay refused: stale checkout" },
      }),
    ).toBeUndefined();
    expect(
      detectFinishedRun({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-run-result-get",
        tool_input: { testCaseId: "tc-1" },
        tool_response: { content: rendered("passed") },
      }),
    ).toBeUndefined();
  });
});
