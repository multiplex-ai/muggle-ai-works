import { describe, expect, it } from "vitest";

import { NO_USER_RESPONSE, UNSCRIPTED_BASH_RESPONSE, UNSCRIPTED_TOOL_RESPONSE } from "../src/constants.js";
import {
  createBashResponder,
  createToolResponder,
  resolveScriptedBashResponse,
  scriptedReplyAt,
} from "../src/tools/scripted-replies.js";
import { isSequencedFixture, sequencedMockToolSpecs } from "../src/tools/sequenced-mock-mcp.js";
import { ScriptedTool, type ScriptedBashResponse } from "../src/types.js";

describe("scriptedReplyAt", () => {
  it("gives the nth call the nth sequence entry and repeats the last", () => {
    const reply = { sequence: ["red", "green"] };
    expect([0, 1, 2, 5].map((callIndex) => scriptedReplyAt(reply, callIndex))).toEqual([
      "red",
      "green",
      "green",
      "green",
    ]);
  });

  it("answers every call with `response` when there is no sequence", () => {
    expect(scriptedReplyAt({ response: "same" }, 3)).toBe("same");
    expect(scriptedReplyAt({ response: "fallback", sequence: [] }, 0)).toBe("fallback");
  });
});

describe("createBashResponder", () => {
  const responses: ScriptedBashResponse[] = [
    { commandContains: "pnpm lint", sequence: ["1 error", "0 errors"] },
    { commandContains: "gh pr checks", response: "lint fail" },
    { commandContains: "", response: UNSCRIPTED_BASH_RESPONSE },
  ];

  it("advances a sequence once per matching call", () => {
    const answerBash = createBashResponder(responses);
    expect(answerBash("pnpm lint")).toBe("1 error");
    expect(answerBash("pnpm lint --fix")).toBe("0 errors");
    expect(answerBash("pnpm lint")).toBe("0 errors");
  });

  it("counts each entry's calls separately and only for the entry that matched first", () => {
    const answerBash = createBashResponder(responses);
    expect(answerBash("gh pr checks 7")).toBe("lint fail");
    expect(answerBash("git status")).toBe(UNSCRIPTED_BASH_RESPONSE);
    expect(answerBash("pnpm lint")).toBe("1 error");
  });

  it("starts fresh per run", () => {
    createBashResponder(responses)("pnpm lint");
    expect(createBashResponder(responses)("pnpm lint")).toBe("1 error");
  });

  it("agrees with the stateless first-call resolver the Codex hook mirrors", () => {
    for (const command of ["pnpm lint", "gh pr checks 7", "curl localhost"]) {
      expect(createBashResponder(responses)(command)).toBe(resolveScriptedBashResponse(command, responses));
    }
  });
});

describe("createToolResponder", () => {
  it("answers each tool from its own entries by argContains, sequencing per entry", () => {
    const answerTool = createToolResponder({
      [ScriptedTool.Skill]: [
        { argContains: "muggle-test-prepare", sequence: ["DEGRADED: dev server down", "READY"] },
        { argContains: "", response: "skill ran" },
      ],
      [ScriptedTool.Agent]: [{ argContains: "visual-walkthrough-builder", response: "posted" }],
    });
    const prepare = JSON.stringify({ skill: "muggle-test-prepare" });
    expect(answerTool(ScriptedTool.Skill, prepare)).toBe("DEGRADED: dev server down");
    expect(answerTool(ScriptedTool.Skill, JSON.stringify({ skill: "muggle-pr-followup" }))).toBe("skill ran");
    expect(answerTool(ScriptedTool.Skill, prepare)).toBe("READY");
    expect(answerTool(ScriptedTool.Agent, JSON.stringify({ subagent_type: "muggle:visual-walkthrough-builder" }))).toBe(
      "posted",
    );
  });

  it("falls back to a recorded-only reply, and tells an unscripted question there is no user", () => {
    const answerTool = createToolResponder(undefined);
    expect(answerTool(ScriptedTool.CronCreate, "{}")).toBe(UNSCRIPTED_TOOL_RESPONSE);
    expect(answerTool(ScriptedTool.AskUserQuestion, "{}")).toBe(NO_USER_RESPONSE);
  });
});

describe("sequenced mock MCP fixtures", () => {
  const replyOf = (specs: ReturnType<typeof sequencedMockToolSpecs>, toolName: string): unknown =>
    specs.find((spec) => spec.name === toolName)!.reply();

  it("recognizes only a lone non-empty sequence key as a sequenced slot", () => {
    expect(isSequencedFixture({ sequence: [1] })).toBe(true);
    expect(isSequencedFixture({ sequence: [] })).toBe(false);
    expect(isSequencedFixture({ sequence: [1], status: "passed" })).toBe(false);
    expect(isSequencedFixture([1])).toBe(false);
  });

  it("answers a sequenced slot in order across every tool that reads it, repeating the last", () => {
    const failing = { runId: "run-1", status: "failed" };
    const passing = { runId: "run-2", status: "passed" };
    const specs = sequencedMockToolSpecs({ executeResult: { sequence: [failing, passing] } });
    expect(replyOf(specs, "muggle-local-execute-test-generation")).toEqual(failing);
    expect(replyOf(specs, "muggle-local-execute-replay")).toEqual(passing);
    expect(replyOf(specs, "muggle-local-execute-replay")).toEqual(passing);
  });

  it("leaves a plain fixture slot as it is", () => {
    const specs = sequencedMockToolSpecs({ runResult: { runId: "run-9", status: "passed" } });
    expect(replyOf(specs, "muggle-local-run-result-get")).toEqual({ runId: "run-9", status: "passed" });
  });
});
