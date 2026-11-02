import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { NO_CONCLUSIVE_RUNS_REASON } from "../src/constants.js";
import { summarizeScenarioVerdicts } from "../src/suite-report.js";
import { isUsageLimitError } from "../src/usage-limit.js";
import { countOrderedMatches, judgeAgentRun } from "../src/verdict.js";
import type { AgentScenario, ArtifactSnapshot, ToolAttempt, ToolAttemptPattern } from "../src/types.js";

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
    expect(missing.reasons[0]).toBe('expected an attempt matching Bash~"build-pr-section"');
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

  it("maxAskUserQuestions allows up to that many questions and fails one past it", () => {
    expect(judgeAgentRun(scenario({ maxAskUserQuestions: 1 }), "ok", [], 1).pass).toBe(true);
    const twice = judgeAgentRun(scenario({ maxAskUserQuestions: 1 }), "ok", [], 2);
    expect(twice.pass).toBe(false);
    expect(twice.reasons[0]).toContain("at most 1");
  });
});

describe("requireToolSequence", () => {
  const read = (file: string): ToolAttempt => ({ tool: "Read", args: { file_path: file } });
  const handoff: ToolAttemptPattern[] = [
    { tool: "muggle-local-execute-replay", argContains: "" },
    { tool: "Bash", argContains: "gh pr create" },
    { tool: "Bash", argContains: "pr-watch-arm.sh" },
  ];
  const replay: ToolAttempt = { tool: "muggle-local-execute-replay", args: {} };

  it("passes when the patterns occur in order, with other attempts between them", () => {
    const attempts = [read("do/e2e.md"), replay, bash("git push"), bash("gh pr create --title x"), read("arm.md"), bash("bash pr-watch-arm.sh")];
    expect(countOrderedMatches(attempts, handoff)).toBe(3);
    expect(judgeAgentRun(scenario({ requireToolSequence: handoff }), "", attempts, 0).pass).toBe(true);
  });

  it("fails when every step happened but out of order, naming the step that broke the order", () => {
    const attempts = [bash("gh pr create --title x"), replay, bash("bash pr-watch-arm.sh")];
    const v = judgeAgentRun(scenario({ requireToolSequence: handoff }), "", attempts, 0);
    expect(v.pass).toBe(false);
    expect(v.reasons[0]).toContain("matched 1/3");
    expect(v.reasons[0]).toContain('missing Bash~"gh pr create"');
  });

  it("does not let one attempt satisfy two steps", () => {
    const twice: ToolAttemptPattern[] = [
      { tool: "Bash", argContains: "pnpm lint" },
      { tool: "Bash", argContains: "pnpm lint" },
    ];
    expect(countOrderedMatches([bash("pnpm lint")], twice)).toBe(1);
    expect(countOrderedMatches([bash("pnpm lint"), bash("pnpm lint")], twice)).toBe(2);
  });

  it("is satisfied by an empty sequence", () => {
    expect(judgeAgentRun(scenario({ requireToolSequence: [] }), "", [], 0).pass).toBe(true);
  });

  it("checks each of requireToolSequences on its own, so reading every stage first still passes", () => {
    const readBeforeAction: ToolAttemptPattern[][] = [
      [{ tool: "Read", argContains: "build.md" }, { tool: "Edit", argContains: "greeting.js" }],
      [{ tool: "Read", argContains: "unit-tests.md" }, { tool: "Bash", argContains: "guard-run" }],
    ];
    const readAllFirst = [read("do/build.md"), read("do/unit-tests.md"), { tool: "Edit", args: { file_path: "src/greeting.js" } }, bash("guard-run -- npm test")];
    expect(judgeAgentRun(scenario({ requireToolSequences: readBeforeAction }), "", readAllFirst, 0).pass).toBe(true);

    const testsBeforeTheirFile = [read("do/build.md"), { tool: "Edit", args: { file_path: "src/greeting.js" } }, bash("guard-run -- npm test"), read("do/unit-tests.md")];
    const v = judgeAgentRun(scenario({ requireToolSequences: readBeforeAction }), "", testsBeforeTheirFile, 0);
    expect(v.pass).toBe(false);
    expect(v.reasons).toHaveLength(1);
    expect(v.reasons[0]).toContain('missing Bash~"guard-run"');
  });

  it("lets an anyOf step be met by any one of its alternatives, so either arming wording passes", () => {
    const watcherArmed: ToolAttemptPattern = {
      anyOf: [
        { tool: "Skill", argContains: "muggle-pr-followup" },
        { tool: "Monitor", argContains: "pr-watch-arm.sh" },
      ],
    };
    const handoffThenArm: ToolAttemptPattern[] = [{ tool: "Bash", argContains: "gh pr create" }, watcherArmed];
    const loopArm: ToolAttempt = { tool: "Skill", args: { skill: "loop", args: "1m /muggle:muggle-pr-followup s 142" } };
    const monitorArm: ToolAttempt = { tool: "Monitor", args: { command: "bash /p/scripts/pr-watch-arm.sh --pr 142" } };
    expect(countOrderedMatches([bash("gh pr create"), loopArm], handoffThenArm)).toBe(2);
    expect(countOrderedMatches([bash("gh pr create"), monitorArm], handoffThenArm)).toBe(2);
    expect(countOrderedMatches([monitorArm, bash("gh pr create")], handoffThenArm)).toBe(1);
    const v = judgeAgentRun(scenario({ requireToolSequence: handoffThenArm }), "", [bash("gh pr create")], 0);
    expect(v.reasons[0]).toContain('missing anyOf(Skill~"muggle-pr-followup" | Monitor~"pr-watch-arm.sh")');
  });
});

describe("requireLastAmong", () => {
  const read = (file: string): ToolAttempt => ({ tool: "Read", args: { file_path: file } });
  const respawnLast = {
    requireLastAmong: [
      { among: { tool: "Read", argContains: "skills/do/" }, last: { tool: "Read", argContains: "respawn-watcher.md" } },
    ],
  };

  it("passes when the latest matching attempt matches last, whatever came after it", () => {
    const attempts = [read("skills/do/fix-ci.md"), read("skills/do/respawn-watcher.md"), bash("bash pr-watch-arm.sh")];
    expect(judgeAgentRun(scenario(respawnLast), "", attempts, 0).pass).toBe(true);
  });

  it("fails when a later matching attempt follows, naming it", () => {
    const attempts = [read("skills/do/respawn-watcher.md"), read("skills/do/cycle-size.md")];
    const v = judgeAgentRun(scenario(respawnLast), "", attempts, 0);
    expect(v.pass).toBe(false);
    expect(v.reasons[0]).toContain("cycle-size.md");
  });

  it("fails when nothing matches among", () => {
    const v = judgeAgentRun(scenario(respawnLast), "", [bash("git push")], 0);
    expect(v.reasons[0]).toContain("none matched");
  });

  // A cycle logs what it did after doing it; a note quoting `git push` is not a push.
  it("skips attempts matching unless when picking the latest", () => {
    const armLast = {
      requireLastAmong: [
        {
          among: { anyOf: [{ tool: "Bash", argContains: "git push" }, { tool: "Bash", argContains: "pr-watch-arm.sh" }] },
          last: { tool: "Bash", argContains: "pr-watch-arm.sh" },
          unless: { tool: "Bash", argContains: "/iterations/" },
        },
      ],
    };
    const note = bash("cat >> ~/.muggle-ai/muggle-do/sessions/s/iterations/001.md <<'EOF'\nfixed lint; git push done\nEOF");
    expect(judgeAgentRun(scenario(armLast), "", [bash("git push"), bash("bash pr-watch-arm.sh"), note], 0).pass).toBe(true);
    expect(judgeAgentRun(scenario(armLast), "", [bash("bash pr-watch-arm.sh"), bash("git push"), note], 0).pass).toBe(false);
    const armAndLog = bash("bash pr-watch-arm.sh --slot s && echo re-armed >> ~/.muggle-ai/muggle-do/sessions/s/iterations/001.md");
    expect(judgeAgentRun(scenario(armLast), "", [bash("git push"), armAndLog], 0).pass).toBe(true);
  });
});

describe("tool-attempt patterns", () => {
  it("requires every substring of an argContains list", () => {
    const failingTitle: ToolAttemptPattern = { tool: "Bash", argContains: ["gh pr create", "[E2E FAILING]"] };
    const expectBlock = { requireToolAttempts: [failingTitle] };
    expect(judgeAgentRun(scenario(expectBlock), "", [bash('gh pr create --title "[E2E FAILING] x"')], 0).pass).toBe(true);
    const plainTitle = judgeAgentRun(scenario(expectBlock), "", [bash('gh pr create --title "x"')], 0);
    expect(plainTitle.reasons).toEqual(['expected an attempt matching Bash~["gh pr create","[E2E FAILING]"]']);
  });

  it("forbids every alternative of an anyOf", () => {
    const forbidArm = { forbidToolAttempts: [{ anyOf: [{ tool: "Skill", argContains: "muggle-pr-followup" }, { tool: "Bash", argContains: "pr-watch-arm.sh" }] }] };
    expect(judgeAgentRun(scenario(forbidArm), "", [bash("bash pr-watch-arm.sh --pr 1")], 0).pass).toBe(false);
    expect(judgeAgentRun(scenario(forbidArm), "", [bash("gh pr view 1")], 0).pass).toBe(true);
  });
});

describe("requireArtifacts", () => {
  const root = path.join(os.tmpdir(), "muggle-agent-eval-run-verdict");
  const snapshot = (fileContents: Record<string, string | null>): ArtifactSnapshot => ({
    paths: { root: root, home: path.join(root, "home"), repo: path.join(root, "repo"), realHome: path.join(os.tmpdir(), "home-of-dev"), passthroughRoots: [] },
    fileContents: fileContents,
  });
  const requirements = { path: "~/.muggle-ai/muggle-do/sessions/s/requirements.md", contains: "Acceptance" };

  it("passes on a sandbox file carrying the content", () => {
    const v = judgeAgentRun(scenario({ requireArtifacts: [requirements] }), "", [], 0, snapshot({ [requirements.path]: "## Acceptance\n- x" }));
    expect(v.pass).toBe(true);
  });

  it("passes on a Bash attempt writing the path, which never ran", () => {
    const attempts = [bash("cat > ~/.muggle-ai/muggle-do/sessions/s/requirements.md <<'EOF'\n## Acceptance\nEOF")];
    const v = judgeAgentRun(scenario({ requireArtifacts: [requirements] }), "", attempts, 0, snapshot({ [requirements.path]: null }));
    expect(v.pass).toBe(true);
  });

  it("fails when neither the sandbox nor any attempt has it", () => {
    const v = judgeAgentRun(scenario({ requireArtifacts: [requirements] }), "", [], 0, snapshot({ [requirements.path]: null }));
    expect(v.pass).toBe(false);
    expect(v.reasons[0]).toContain(requirements.path);
  });

  it("checks `matches` for where a value sits, not only that it appears", () => {
    const iteration = "~/.muggle-ai/muggle-do/sessions/s/iterations/001.md";
    const retiredAsRemoved = {
      path: iteration,
      matches: "retiredTestCases:(?:(?!newUseCases)[\\s\\S])*tc-old(?:(?!replacedBy)[\\s\\S])*replacedBy: none",
    };
    const retired = "retiredTestCases:\n  - testCaseId: tc-old\n    replacedBy: none\nnewUseCases: []";
    const impacted = "impactedTestCases:\n  - testCaseId: tc-old\nretiredTestCases: []\nnewUseCases: []\n  replacedBy: none";
    expect(judgeAgentRun(scenario({ requireArtifacts: [retiredAsRemoved] }), "", [], 0, snapshot({ [iteration]: retired })).pass).toBe(true);
    const misplaced = judgeAgentRun(scenario({ requireArtifacts: [retiredAsRemoved] }), "", [], 0, snapshot({ [iteration]: impacted }));
    expect(misplaced.pass).toBe(false);
    expect(misplaced.reasons[0]).toContain("matching /retiredTestCases:");
  });

  it("fails rather than passing silently when the run had no sandbox", () => {
    const v = judgeAgentRun(scenario({ requireArtifacts: [requirements] }), "", [], 0);
    expect(v.reasons[0]).toContain("no sandbox");
  });
});

describe("summarizeScenarioVerdicts", () => {
  const verdict = (pass: boolean, reason?: string) => ({
    scenario: "s",
    pass: pass,
    reasons: reason ? [reason] : [],
    trace: { finalOutput: "", toolAttempts: [], askQuestionCount: 0 },
  });

  it("judges the pass rate against the suite's own threshold", () => {
    const fourOfFive = [verdict(true), verdict(true), verdict(true), verdict(true), verdict(false, "missed arm")];
    expect(summarizeScenarioVerdicts("s", fourOfFive, 0.8)).toMatchObject({ passes: 4, runs: 5, passed: true });
    expect(summarizeScenarioVerdicts("s", fourOfFive, 1)).toMatchObject({ passed: false, failureReasons: ["missed arm"] });
  });

  it("never passes a scenario that ran no reps", () => {
    expect(summarizeScenarioVerdicts("s", [], 0.8).passed).toBe(false);
  });

  it("averages the cost and time of the reps that reported usage", () => {
    const withUsage = (costUsd: number, durationMs: number) => ({ ...verdict(true), usage: { costUsd: costUsd, durationMs: durationMs, turns: 40 } });
    expect(summarizeScenarioVerdicts("s", [withUsage(1, 60_000), withUsage(2, 120_000), verdict(false)], 1)).toMatchObject({
      meanCostUsd: 1.5,
      meanDurationMs: 90_000,
    });
    expect(summarizeScenarioVerdicts("s", [verdict(true)], 1)).toMatchObject({ meanCostUsd: null, meanDurationMs: null });
  });

  const usageLimited = () => ({ ...verdict(false, "no result — usage limit"), isInconclusive: true });

  it("leaves reps stopped by a usage limit out of the pass rate", () => {
    expect(summarizeScenarioVerdicts("s", [verdict(true), verdict(true), usageLimited()], 1)).toMatchObject({
      runs: 2,
      passes: 2,
      passRate: 1,
      passed: true,
      inconclusiveRuns: 1,
      failureReasons: [],
    });
  });

  it("fails a scenario whose every rep stopped on a usage limit, saying so", () => {
    expect(summarizeScenarioVerdicts("s", [usageLimited(), usageLimited()], 0.8)).toMatchObject({
      runs: 0,
      passed: false,
      inconclusiveRuns: 2,
      failureReasons: [NO_CONCLUSIVE_RUNS_REASON],
    });
  });
});

describe("isUsageLimitError", () => {
  it.each([
    "Error: Claude Code returned an error result: You've hit your session limit · resets 10am (UTC)",
    "Error: Claude Code returned an error result: You've hit your weekly limit · resets Nov 6, 6am (UTC)",
    "Claude AI usage limit reached|1762000000",
  ])("recognizes %s", (message) => {
    expect(isUsageLimitError(new Error(message))).toBe(true);
  });

  it.each(["Error: context window exceeded", "Error: 529 overloaded_error", "socket hang up"])(
    "leaves %s a failed rep",
    (message) => {
      expect(isUsageLimitError(new Error(message))).toBe(false);
    },
  );
});
