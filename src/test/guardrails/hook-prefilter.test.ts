import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { join } from "path";
import type { GuardrailState } from "../../guardrails/types.js";

// Each bash wrapper re-encodes, in shell, the payloads its guardrails.mjs
// subcommand acts on. Nothing ties the two together, so a marker a gate's own
// instruction tells the user to run can be short-circuited before Node ever
// sees it — the failure that made MUGGLE_WATCH_SKIP and MUGGLE_WALKTHROUGH_SKIP
// dead tokens while the gates kept demanding them. These assertions run on every
// platform; the end-to-end wrapper runs in hook-execution.test.ts are bash-only.
const SCRIPTS = fileURLToPath(new URL("../../../plugin/scripts", import.meta.url));
const GUARDRAIL_SOURCE = fileURLToPath(new URL("../../guardrails", import.meta.url));

// src/guardrails/ groups related units into purpose folders, so a scan that
// only reads top-level entries goes blind to anything nested — and a skip
// marker the gates advertise but the scan cannot see is the dead-escape-hatch
// bug these assertions exist to catch.
function guardrailSourceFiles(dir: string = GUARDRAIL_SOURCE): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? guardrailSourceFiles(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}


function payloadPrefilter(wrapperScriptName: string): RegExp {
  const wrapperBody = readFileSync(join(SCRIPTS, wrapperScriptName), "utf-8");
  const prefilter = wrapperBody.match(/grep -Eiq '([^']+)'/);
  if (!prefilter) throw new Error(`${wrapperScriptName} has no payload pre-filter`);
  return new RegExp(prefilter[1].replaceAll("[[:space:]]", "\\s"), "i");
}

const commandPayload = (command: string): string =>
  JSON.stringify({ tool_name: "Bash", tool_input: { command: command } });

const outputPayload = (stderr: string): string =>
  JSON.stringify({ tool_name: "Bash", tool_response: { stderr: stderr } });

describe("record-tests pre-filter reaches every payload the recorder acts on", () => {
  const prefilter = payloadPrefilter("guardrail-record-tests.sh");
  const reaching: Array<[string, string]> = [
    ["a unit-test run", commandPayload("pnpm test")],
    ["a muggle replay tool call", JSON.stringify({ tool_name: "mcp__muggle__muggle-local-execute-replay" })],
    [
      "a muggle-test skill telemetry emit",
      JSON.stringify({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit",
        tool_input: { skillName: "muggle-test" },
      }),
    ],
    ["a walkthrough posted as a PR comment", commandPayload("gh pr comment 7 --body-file walkthrough.md")],
    [
      "a walkthrough edited into an existing comment",
      commandPayload("gh api --method PATCH repos/o/r/issues/comments/12345 --input walkthrough.json"),
    ],
  ];

  it.each(reaching)("spawns Node for %s", (_label, payload) => {
    expect(prefilter.test(payload)).toBe(true);
  });

  // Derived from the source rather than listed here, so a marker added to a
  // future gate is covered the moment it exists — listing them by hand is how
  // the pre-filter came to know only MUGGLE_E2E_SKIP.
  it("spawns Node for every skip marker the guardrails define", () => {
    const markerTokens = new Set(
      guardrailSourceFiles().flatMap(
        (path) => readFileSync(path, "utf-8").match(/MUGGLE_[A-Z0-9_]+_SKIP/g) ?? [],
      ),
    );
    expect(markerTokens.size).toBeGreaterThanOrEqual(3);
    for (const token of markerTokens) {
      expect(prefilter.test(commandPayload(`echo "${token}: reason"`)), token).toBe(true);
    }
  });

  it("short-circuits an unrelated command", () => {
    expect(prefilter.test(commandPayload("git log --oneline -5"))).toBe(false);
  });
});

describe("pr-terminal pre-filter reaches every payload the detector acts on", () => {
  const prefilter = payloadPrefilter("guardrail-pr-terminal.sh");
  const reaching: Array<[string, string]> = [
    ["a merge success line", outputPayload("✓ Merged pull request o/r#341 (feat: thing)")],
    ["a squash-merge success line", outputPayload("✓ Squashed and merged pull request o/r#341 (feat: thing)")],
    ["a close success line", outputPayload("✓ Closed pull request o/r#369 (stale)")],
    ["a reopen success line", outputPayload("✓ Reopened pull request o/r#369 (gate fix)")],
    ["the watch monitor's terminal exit line", JSON.stringify({ tool_name: "Monitor", tool_response: { stdout: "TERMINAL pr=331: MERGED" } })],
  ];

  it.each(reaching)("spawns Node for %s", (_label, payload) => {
    expect(prefilter.test(payload)).toBe(true);
  });

  it("short-circuits an unrelated command", () => {
    expect(prefilter.test(commandPayload("git status"))).toBe(false);
  });
});

describe("report-format pre-filter reaches every command the gate can deny", () => {
  const prefilter = payloadPrefilter("guardrail-report-format.sh");
  const reaching: Array<[string, string]> = [
    ["a new PR comment", commandPayload("gh pr comment 1 --body 'results'")],
    ["a PR description at creation", commandPayload("gh pr create --title x --body y")],
    ["a PR description edit", commandPayload("gh pr edit 1 --body y")],
    [
      "an edit to an existing comment",
      commandPayload("gh api --method PATCH repos/o/r/issues/comments/12345 -f body=@report.md"),
    ],
  ];

  it.each(reaching)("spawns Node for %s", (_label, payload) => {
    expect(prefilter.test(payload)).toBe(true);
  });

  it("short-circuits an unrelated command", () => {
    expect(prefilter.test(commandPayload("git status"))).toBe(false);
  });
});

describe("resolve-gate pre-filter reaches every command the gate can deny", () => {
  const prefilter = payloadPrefilter("guardrail-resolve-gate.sh");
  const reaching: Array<[string, string]> = [
    [
      "a GitHub thread resolve",
      commandPayload(`gh api graphql -f query='mutation{resolveReviewThread(input:{threadId:"T"}){thread{id}}}'`),
    ],
    [
      "a GitLab discussion resolve",
      commandPayload("glab api --method PUT 'projects/1/merge_requests/2/discussions/a?resolved=true'"),
    ],
  ];

  it.each(reaching)("spawns Node for %s", (_label, payload) => {
    expect(prefilter.test(payload)).toBe(true);
  });

  it("short-circuits an unrelated command", () => {
    expect(prefilter.test(commandPayload("git status"))).toBe(false);
  });
});

describe("pr-opened pre-filter reaches every command the detector acts on", () => {
  const prefilter = payloadPrefilter("guardrail-pr-opened.sh");
  const reaching: Array<[string, string]> = [
    ["gh pr create", commandPayload("gh pr create --fill")],
    ["gh pr ready", commandPayload("gh pr ready 12")],
    ["glab mr create", commandPayload("glab mr create --fill")],
    ["glab mr update --ready", commandPayload("glab mr update 5 --ready")],
  ];

  it.each(reaching)("spawns Node for %s", (_label, payload) => {
    expect(prefilter.test(payload)).toBe(true);
  });

  it("short-circuits an unrelated command", () => {
    expect(prefilter.test(commandPayload("ls -la"))).toBe(false);
  });
});

describe("record-comment-replies pre-filter reaches every payload the recorder acts on", () => {
  const prefilter = payloadPrefilter("guardrail-record-comment-replies.sh");
  const reaching: Array<[string, string]> = [
    [
      "the github unresolved-threads query",
      commandPayload("gh api graphql -f query='{ reviewThreads(first: 100) { nodes { id } } }'"),
    ],
    [
      "the gitlab discussions listing",
      commandPayload("glab api projects/:id/merge_requests/12/discussions --paginate"),
    ],
    [
      "a github threaded reply",
      commandPayload("gh api --method POST repos/o/r/pulls/7/comments/11/replies -f body=x"),
    ],
    [
      "a gitlab discussion note",
      commandPayload("glab api --method POST projects/:id/merge_requests/12/discussions/a1b2/notes -f body=x"),
    ],
  ];

  it.each(reaching)("spawns Node for %s", (_label, payload) => {
    expect(prefilter.test(payload)).toBe(true);
  });

  it("spawns Node for the reply skip marker", () => {
    expect(prefilter.test(commandPayload('echo "MUGGLE_REPLY_SKIP: 11 escalated"'))).toBe(true);
  });

  it("short-circuits an unrelated command", () => {
    expect(prefilter.test(commandPayload("ls -la"))).toBe(false);
  });

  // The claim marks a thread as taken, so a push carries no signal any more and
  // spawning Node on one would be pure waste.
  it("short-circuits a push", () => {
    expect(prefilter.test(commandPayload("git push origin users/stan4/fix"))).toBe(false);
  });
});

describe("build-router pre-filter reaches every prompt detectBuildIntent accepts", () => {
  const prefilter = payloadPrefilter("guardrail-build-router.sh");
  const reaching: Array<[string, string]> = [
    ["a build verb", JSON.stringify({ prompt: "implement a dark-mode toggle" })],
    ["a wire-up ask", JSON.stringify({ prompt: "wire up the export button" })],
    ["a conflict-resolution ask", JSON.stringify({ prompt: "resolve the merge conflicts on my branch" })],
    ["a drive-the-PR-green ask", JSON.stringify({ prompt: "get PR 12 to green" })],
  ];

  it.each(reaching)("spawns Node for %s", (_label, payload) => {
    expect(prefilter.test(payload)).toBe(true);
  });

  it("short-circuits a question", () => {
    expect(prefilter.test(JSON.stringify({ prompt: "what time is it?" }))).toBe(false);
  });
});

// The Stop gates pre-filter on the per-session state file instead of a payload,
// which couples them to sessionState's exact serialization — key names, the
// two-space indent, and the empty-array form. A renamed field or a changed
// indent would silently retire the gate rather than break it.
describe("state-file pre-filters match the state guardrails.mjs writes", () => {
  // The widest state the type allows — every declared field set, every array
  // non-empty. Typed Required<GuardrailState> so a field added to the state
  // fails to compile until it is represented, and re-checked below against the
  // declaration itself because tsconfig excludes tests from the typecheck.
  const populatedState: Required<GuardrailState> = {
    sessionId: "s",
    generation: 1,
    prsHandled: ["https://github.com/o/r/pull/1"],
    unitTestsGreen: true,
    e2eRun: true,
    e2eSkipped: true,
    e2eBlockCount: 1,
    buildIntentRouted: true,
    terminalPending: [7],
    terminalHandled: [7],
    terminalBlockCount: 1,
    watchSkipped: true,
    watchBlockCount: 1,
    walkthroughPosted: true,
    walkthroughSkipped: true,
    walkthroughBlockCount: 1,
    lastInvokedSkillName: "muggle-do",
    mandatoryStages: ["stages/plan.md"],
    stagesRead: ["stages/plan.md"],
    stageSkipped: true,
    stageBlockCount: 1,
    classifiedTestCaseIds: ["tc-1"],
    classificationSkipped: true,
    failedRuns: ["run-1"],
    debuggedRuns: ["run-1"],
    debugSkipped: true,
    debugBlockCount: 1,
    commentReplySkipped: true,
    commentReplyBlockCount: 1,
    capabilityClaimNudged: true,
  };

  // A gate reads "nothing owed" as an empty array and pre-filters on the
  // one-line `"<field>": []` form, which only a drained state serializes.
  const drainedState = Object.fromEntries(
    Object.entries(populatedState).map(([field, value]) => [field, Array.isArray(value) ? [] : value]),
  );
  const serializedStates = [populatedState, drainedState]
    .map((state) => JSON.stringify(state, null, 2))
    .join("\n");

  const declaredStateFields = (): string[] => {
    const declaration = readFileSync(join(GUARDRAIL_SOURCE, "types.ts"), "utf-8").match(
      /export interface GuardrailState \{([^}]+)\}/,
    );
    if (!declaration) throw new Error("GuardrailState is no longer declared in guardrails/types.ts");
    return [...declaration[1].matchAll(/^\s*(\w+)\??:/gm)].map(([, field]) => field);
  };

  const gateSourceBodies = guardrailSourceFiles()
    .filter((path) => !path.endsWith("types.ts"))
    .map((path) => readFileSync(path, "utf-8"));

  const wrapperScriptNames = readdirSync(SCRIPTS).filter(
    (name) => name.startsWith("guardrail-") && name.endsWith(".sh"),
  );

  const statePrefilterLiterals = (wrapperScriptName: string): string[] =>
    [...readFileSync(join(SCRIPTS, wrapperScriptName), "utf-8").matchAll(/grep -q '([^']+)'/g)].map(
      ([, statePattern]) => statePattern.replaceAll("\\[", "[").replaceAll("\\]", "]"),
    );

  const prefilteredStateField = (literal: string): string => {
    const field = literal.match(/^"(\w+)"/)?.[1];
    if (!field) throw new Error(`pre-filter ${literal} names no state field`);
    return field;
  };

  // Equality, not superset: padding the fixture with an invented field is how a
  // typo'd pre-filter would slip through, and a field the state gains has to be
  // represented here even where the typecheck skips this file.
  it("holds exactly the fields GuardrailState declares", () => {
    expect(Object.keys(populatedState).sort()).toEqual(declaredStateFields().sort());
  });

  it.each(wrapperScriptNames)("%s greps only for shapes the state file can hold", (wrapperScriptName) => {
    for (const literal of statePrefilterLiterals(wrapperScriptName)) {
      expect(serializedStates, `${wrapperScriptName} greps for ${literal}`).toContain(literal);
    }
  });

  // Declaring a field is not writing one. A gate that pre-filters on a field no
  // guardrail ever touches is the dead-escape-hatch bug in state-file form: the
  // grep never matches, so the gate silently never fires.
  it.each(wrapperScriptNames)("%s greps only for fields a gate maintains", (wrapperScriptName) => {
    for (const literal of statePrefilterLiterals(wrapperScriptName)) {
      const field = prefilteredStateField(literal);
      expect(
        gateSourceBodies.some((body) => body.includes(field)),
        `${wrapperScriptName} greps for ${field}, which no guardrail writes`,
      ).toBe(true);
    }
  });
});
