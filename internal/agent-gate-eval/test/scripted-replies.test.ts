import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_ACTION_SCRIPT,
  DEFAULT_TEST_CASE_ANCESTORS,
  HOST_STUB_SPECS,
  NO_USER_RESPONSE,
  UNSCRIPTED_BASH_RESPONSE,
  UNSCRIPTED_TOOL_RESPONSE,
} from "../src/constants.js";
import {
  createBashResponder,
  createToolResponder,
  resolveScriptedBashResponse,
  scriptedReplyAt,
} from "../src/tools/scripted-replies.js";
import { createMockToolAnswerer, isSequencedFixture, sequencedMockToolSpecs } from "../src/tools/sequenced-mock-mcp.js";
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

describe("createBashResponder with commands the harness runs", () => {
  const responses: ScriptedBashResponse[] = [
    { commandContains: " show", response: "9f2c1e4 feat: farewell", run: "git diff --stat HEAD" },
    { commandContains: " diff", run: "git diff HEAD" },
    { commandContains: "gh pr list", response: "" },
  ];

  it("follows an entry's scripted reply with the output of the entry's own command", () => {
    const runInRepo = vi.fn((command: string) => `ran ${command}`);
    const answer = createBashResponder(responses, runInRepo);
    expect(answer("git show HEAD")).toBe("9f2c1e4 feat: farewell\nran git diff --stat HEAD");
    expect(answer("git diff main...HEAD")).toBe("ran git diff HEAD");
  });

  it("runs the entry's command, never the one the agent wrote", () => {
    const runInRepo = vi.fn((command: string) => `ran ${command}`);
    createBashResponder(responses, runInRepo)("git diff main...HEAD -- . ':!secrets'");
    expect(runInRepo).toHaveBeenCalledWith("git diff HEAD");
    expect(runInRepo).toHaveBeenCalledTimes(1);
  });

  it("runs nothing for an entry without a command", () => {
    const runInRepo = vi.fn((command: string) => command);
    expect(createBashResponder(responses, runInRepo)("gh pr list --head x")).toBe("");
    expect(runInRepo).not.toHaveBeenCalled();
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

  it("answers an afterCommandContains entry only once an earlier command carried its substring", () => {
    const afterCommit: ScriptedBashResponse[] = [
      { commandContains: "git status", afterCommandContains: "git commit", response: "nothing to commit" },
      { commandContains: "git status", response: "modified: README.md" },
    ];
    const answerBash = createBashResponder(afterCommit);
    expect(answerBash("git status")).toBe("modified: README.md");
    expect(answerBash("git commit -m x")).toBe(UNSCRIPTED_BASH_RESPONSE);
    expect(answerBash("git status")).toBe("nothing to commit");
    expect(resolveScriptedBashResponse("git status", afterCommit)).toBe("modified: README.md");
    expect(resolveScriptedBashResponse("git commit -m x && git status", afterCommit)).toBe("nothing to commit");
  });

  it("starts fresh per run", () => {
    createBashResponder(responses)("pnpm lint");
    expect(createBashResponder(responses)("pnpm lint")).toBe("1 error");
  });

  it("agrees with the stateless first-call resolver the Codex hook mirrors", () => {
    for (const command of ["pnpm lint", "gh pr checks 7", "curl localhost", "cd repo && pnpm lint"]) {
      expect(createBashResponder(responses)(command)).toBe(resolveScriptedBashResponse(command, responses));
    }
  });
});

describe("createBashResponder on a chained command", () => {
  const responses: ScriptedBashResponse[] = [
    { commandContains: "rev-parse HEAD", response: "9f2c1e4" },
    { commandContains: "gh pr view", response: '{"title":"[UNIT-ONLY] fix"}' },
    { commandContains: "git fetch", response: "" },
    { commandContains: "pnpm lint", sequence: ["1 error", "0 errors"] },
    { commandContains: "", response: "catch-all" },
  ];

  it("answers each chained command and joins the replies in order", () => {
    expect(resolveScriptedBashResponse("git rev-parse HEAD && gh pr view 57 --json title", responses)).toBe(
      '9f2c1e4\n{"title":"[UNIT-ONLY] fix"}',
    );
    expect(resolveScriptedBashResponse("gh pr view 57; git rev-parse HEAD", responses)).toBe(
      '{"title":"[UNIT-ONLY] fix"}\n9f2c1e4',
    );
  });

  it("prints nothing for a command only the catch-all matches, or whose reply is empty", () => {
    expect(resolveScriptedBashResponse("make build && git fetch origin && git rev-parse HEAD", responses)).toBe(
      "9f2c1e4",
    );
  });

  it("prints what the shell would for a cd, an assignment or an echo of literals", () => {
    const sessionStubs: ScriptedBashResponse[] = [
      { commandContains: "pr-watch-verdict", response: "VERDICT=block-ci-escalated" },
      { commandContains: "sessions", response: "muggle-ai-works-pr504" },
    ];
    expect(
      resolveScriptedBashResponse(
        'cd /tmp/sessions && SLOT_DIR="/tmp/sessions/pr504"\nnode pr-watch-verdict.mjs tick',
        sessionStubs,
      ),
    ).toBe("VERDICT=block-ci-escalated");
    expect(resolveScriptedBashResponse('git rev-parse HEAD; echo "--- view"; gh pr view 57', responses)).toBe(
      '9f2c1e4\n--- view\n{"title":"[UNIT-ONLY] fix"}',
    );
    expect(resolveScriptedBashResponse("git rev-parse HEAD && echo FOUND || echo MISSING", responses)).toBe("9f2c1e4");
  });

  it("answers the chain whole when no chained command matches a specific entry", () => {
    expect(resolveScriptedBashResponse("cd /repo && make build", responses)).toBe("catch-all");
    expect(resolveScriptedBashResponse("cd /repo && make build", responses.slice(0, -1))).toBe(
      UNSCRIPTED_BASH_RESPONSE,
    );
  });

  it("advances a sequence once per chained command it answers", () => {
    const answerBash = createBashResponder(responses);
    expect(answerBash("pnpm lint; pnpm lint --fix")).toBe("1 error\n0 errors");
    expect(answerBash("pnpm lint")).toBe("0 errors");
  });

  it("answers a command with a heredoc whole", () => {
    expect(
      resolveScriptedBashResponse("gh pr view 57 --body-file - <<'EOF'\nfixed; pnpm lint passes\nEOF", responses),
    ).toBe('{"title":"[UNIT-ONLY] fix"}');
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

  it("answers the cron and task tools a watcher drives", () => {
    const answerTool = createToolResponder({
      [ScriptedTool.CronList]: [{ argContains: "", response: "No scheduled jobs." }],
      [ScriptedTool.TaskStop]: [{ argContains: "mon_7c1e", response: "Stopped task mon_7c1e." }],
    });
    expect(answerTool(ScriptedTool.CronList, "{}")).toBe("No scheduled jobs.");
    expect(answerTool(ScriptedTool.TaskStop, JSON.stringify({ task_id: "mon_7c1e" }))).toBe("Stopped task mon_7c1e.");
    expect(answerTool(ScriptedTool.TaskStop, JSON.stringify({ task_id: "other" }))).toBe(UNSCRIPTED_TOOL_RESPONSE);
  });

  it("serves every scripted tool but AskUserQuestion as a host stub", () => {
    expect(HOST_STUB_SPECS.map((spec) => spec.tool).sort()).toEqual(
      Object.values(ScriptedTool)
        .filter((tool) => tool !== ScriptedTool.AskUserQuestion)
        .sort(),
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
    specs.find((spec) => spec.name === toolName)!.reply({});

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

  it("serves the E2E stage's cloud reads beside the shared tools, from their slots or a stub", () => {
    const testCases = { items: [{ id: "tc-1" }] };
    const specs = sequencedMockToolSpecs({ testCases: testCases, testScript: { id: "ts-1", steps: [{ stepIndex: 0 }] } });
    expect(replyOf(specs, "muggle-remote-test-case-list")).toEqual(testCases);
    expect(replyOf(specs, "muggle-remote-test-case-list-by-use-case")).toEqual(testCases);
    expect(replyOf(specs, "muggle-remote-test-script-get")).toEqual({ id: "ts-1", steps: [{ stepIndex: 0 }] });
    expect(replyOf(specs, "muggle-remote-test-case-ancestors-get")).toEqual(DEFAULT_TEST_CASE_ANCESTORS);
    expect(replyOf(specs, "muggle-remote-action-script-get")).toEqual(DEFAULT_ACTION_SCRIPT);
  });
});

describe("createMockToolAnswerer", () => {
  it("answers a mock tool by bare name as the MCP text the server would send, with its own sequence counts", () => {
    const fixtures = { executeResult: { sequence: [{ status: "failed" }, { status: "passed" }] } };
    const answerMockTool = createMockToolAnswerer(fixtures);
    expect(answerMockTool("muggle-local-execute-replay")).toBe(JSON.stringify({ status: "failed" }));
    expect(answerMockTool("muggle-local-execute-replay")).toBe(JSON.stringify({ status: "passed" }));
    expect(createMockToolAnswerer(fixtures)("muggle-local-execute-replay")).toBe(JSON.stringify({ status: "failed" }));
  });

  it("refuses a name no mock tool has", () => {
    expect(() => createMockToolAnswerer({})("muggle-remote-wallet-topup")).toThrow(/no mock muggle tool/);
  });
});
