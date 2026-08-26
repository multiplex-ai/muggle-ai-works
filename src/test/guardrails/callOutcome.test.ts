import { describe, it, expect } from "vitest";
import { callFailed } from "../../guardrails/callOutcome.js";
import { detectWalkthroughPost } from "../../guardrails/walkthroughPosted.js";
import { detectDebugEvidenceRunIds } from "../../guardrails/debugPath.js";
import { detectClassifiedTestCaseId } from "../../guardrails/preExecutionClassification.js";
import { REPORT_SENTINEL } from "../../guardrails/prReportPost.js";
import { PRE_EXECUTION_CLASSIFICATION_EVENT } from "../../guardrails/constants.js";

describe("callFailed", () => {
  it.each([
    ["a gh CLI rejection", { stderr: "gh: Validation Failed (HTTP 422)" }],
    ["a glab CLI rejection", { stderr: "glab: 404 Not Found" }],
    ["a bare HTTP status", { stdout: "HTTP 500 Internal Server Error" }],
    ["a JSON status field", { stdout: '{"message":"Bad Request","status":"400"}' }],
    ["an MCP error envelope", { content: '{"isError":true,"content":[]}' }],
  ])("sees %s", (_label, response) => {
    expect(callFailed({ tool_name: "Bash", tool_response: response })).toBe(true);
  });

  it.each([
    ["a successful comment post", { stdout: "https://github.com/o/r/pull/7#issuecomment-1" }],
    ["an empty response", {}],
  ])("stays quiet on %s", (_label, response) => {
    expect(callFailed({ tool_name: "Bash", tool_response: response })).toBe(false);
  });

  // The whole reason the signals are anchored: an acceptance report says
  // "failed" and "error" as a matter of course, and `gh api` echoes the body it
  // just posted straight back.
  it("does not read a walkthrough's own failure prose as a failed call", () => {
    const body = `${REPORT_SENTINEL} — 2 flows failed, 1 error captured in the run`;
    expect(callFailed({ tool_name: "Bash", tool_response: { stdout: body } })).toBe(false);
  });
});

const REJECTED = { stdout: "", stderr: "gh: Validation Failed (HTTP 422)" };
const ACCEPTED = { stdout: "https://github.com/o/r/pull/7#issuecomment-1" };

describe("recorders withhold on a rejected call", () => {
  const postCommand = `gh pr comment 7 --body '${REPORT_SENTINEL} results'`;

  it("does not mark a walkthrough posted when the publish was rejected", () => {
    expect(
      detectWalkthroughPost({
        tool_name: "Bash",
        tool_input: { command: postCommand },
        tool_response: REJECTED,
      }),
    ).toBe(false);
  });

  it("still marks a walkthrough posted when the publish succeeded", () => {
    expect(
      detectWalkthroughPost({
        tool_name: "Bash",
        tool_input: { command: postCommand },
        tool_response: ACCEPTED,
      }),
    ).toBe(true);
  });

  it("does not count a rejected feedback submission as debug evidence", () => {
    expect(
      detectDebugEvidenceRunIds(
        {
          tool_name: "mcp__muggle__muggle-remote-user-feedback-create",
          tool_input: { runId: "run-77" },
          tool_response: { stdout: '{"message":"Bad Request","status":"400"}' },
        },
        ["run-77"],
      ),
    ).toEqual([]);
  });

  it("still counts an accepted feedback submission as debug evidence", () => {
    expect(
      detectDebugEvidenceRunIds(
        {
          tool_name: "mcp__muggle__muggle-remote-user-feedback-create",
          tool_input: { runId: "run-77" },
          tool_response: { stdout: '{"id":"fb-1","runId":"run-77"}' },
        },
        ["run-77"],
      ),
    ).toEqual(["run-77"]);
  });

  it("does not treat a rejected classification emit as a classification", () => {
    expect(
      detectClassifiedTestCaseId({
        tool_name: "mcp__muggle__muggle-local-telemetry-event-emit",
        tool_input: { eventType: PRE_EXECUTION_CLASSIFICATION_EVENT, testCaseId: "tc-1" },
        tool_response: { content: '{"isError":true}' },
      }),
    ).toBeUndefined();
  });

  it("still treats an accepted classification emit as a classification", () => {
    expect(
      detectClassifiedTestCaseId({
        tool_name: "mcp__muggle__muggle-local-telemetry-event-emit",
        tool_input: { eventType: PRE_EXECUTION_CLASSIFICATION_EVENT, testCaseId: "tc-1" },
        tool_response: { content: "ok" },
      }),
    ).toBe("tc-1");
  });
});

describe("a failed Read does not mark a stage read", () => {
  it("sees a Read that errored", () => {
    expect(
      callFailed({
        tool_name: "Read",
        tool_input: { file_path: "/p/skills/_shared/missing.md" },
        tool_response: { stdout: '{"isError":true,"content":"File does not exist"}' },
      }),
    ).toBe(true);
  });

  it("stays quiet on a Read that returned content", () => {
    expect(
      callFailed({
        tool_name: "Read",
        tool_input: { file_path: "/p/skills/_shared/debug-failed-run.md" },
        tool_response: { stdout: "# Debug a failed run\n\nStep 1 ..." },
      }),
    ).toBe(false);
  });
});
