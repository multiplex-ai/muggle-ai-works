import { describe, expect, it } from "vitest";

import { judgeAgentRun } from "./verdict.js";
import type { AgentScenario, ToolAttempt } from "./types.js";

function scenario(expectBlock: AgentScenario["expect"]): AgentScenario {
  return { name: "s", prompt: "p", expect: expectBlock };
}

const bash = (command: string): ToolAttempt => ({
  tool: "Bash",
  args: { command: command },
});

describe("judgeAgentRun", () => {
  it("passes when every output assertion holds", () => {
    const v = judgeAgentRun(
      scenario({
        outputContains: ["READY"],
        outputMatches: ["(^|\\n)READY\\b"],
        outputNotContains: ["DEGRADED:"],
      }),
      "READY\nService  PID  Port",
      [],
      0,
    );
    expect(v.pass).toBe(true);
    expect(v.reasons).toEqual([]);
  });

  it("fails on a missing required substring and a forbidden one present", () => {
    const v = judgeAgentRun(
      scenario({ outputContains: ["READY"], outputNotContains: ["DEGRADED:"] }),
      "DEGRADED: frontend failed its smoke test",
      [],
      0,
    );
    expect(v.pass).toBe(false);
    expect(v.reasons).toHaveLength(2);
  });

  it("outputNotMatches rejects a line-anchored READY while allowing the word elsewhere", () => {
    const anchored = { outputNotMatches: ["(^|\\n)READY(\\r?\\n|$)"] };
    expect(judgeAgentRun(scenario(anchored), "READY\ntable", [], 0).pass).toBe(false);
    expect(
      judgeAgentRun(scenario(anchored), "needs-input: the READY criteria are unmet", [], 0).pass,
    ).toBe(true);
  });

  it("requireToolAttempts matches tool name plus serialized-arg substring", () => {
    const expectBlock = {
      requireToolAttempts: [{ tool: "Bash", argContains: "build-pr-section" }],
    };
    expect(
      judgeAgentRun(scenario(expectBlock), "body:", [bash("muggle build-pr-section < r.json")], 0).pass,
    ).toBe(true);
    const missing = judgeAgentRun(scenario(expectBlock), "body:", [bash("gh pr view 1")], 0);
    expect(missing.pass).toBe(false);
    expect(missing.reasons[0]).toContain("build-pr-section");
  });

  it("forbidToolAttempts fails when the forbidden call was attempted", () => {
    const v = judgeAgentRun(
      scenario({ forbidToolAttempts: [{ tool: "Bash", argContains: "gh pr comment" }] }),
      "body:",
      [bash("jq -r .body x | gh pr comment 12 --body-file -")],
      0,
    );
    expect(v.pass).toBe(false);
  });

  it("asking the user fails by default and is recorded in the trace", () => {
    const v = judgeAgentRun(scenario({}), "needs-input: port", [], 2);
    expect(v.pass).toBe(false);
    expect(v.reasons[0]).toContain("no-user-channel");
    expect(v.trace.askQuestionCount).toBe(2);
  });

  it("forbidAskUserQuestion=false relaxes the ask rule explicitly", () => {
    const v = judgeAgentRun(scenario({ forbidAskUserQuestion: false }), "ok", [], 1);
    expect(v.pass).toBe(true);
  });
});
