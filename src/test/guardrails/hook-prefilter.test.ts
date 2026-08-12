import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { join } from "path";

// Each bash wrapper re-encodes, in shell, the payloads its guardrails.mjs
// subcommand acts on. Nothing ties the two together, so a marker a gate's own
// instruction tells the user to run can be short-circuited before Node ever
// sees it — the failure that made MUGGLE_WATCH_SKIP and MUGGLE_WALKTHROUGH_SKIP
// dead tokens while the gates kept demanding them. These assertions run on every
// platform; the end-to-end wrapper runs in hook-execution.test.ts are bash-only.
const SCRIPTS = fileURLToPath(new URL("../../../plugin/scripts", import.meta.url));
const GUARDRAIL_SOURCE = fileURLToPath(new URL("../../guardrails", import.meta.url));

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
      readdirSync(GUARDRAIL_SOURCE).flatMap(
        (name) =>
          readFileSync(join(GUARDRAIL_SOURCE, name), "utf-8").match(/MUGGLE_[A-Z0-9_]+_SKIP/g) ?? [],
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
  const armedState = JSON.stringify(
    {
      sessionId: "s",
      prsHandled: ["https://github.com/o/r/pull/1"],
      unitTestsGreen: true,
      e2eRun: true,
      terminalPending: [7],
      watchSkipped: true,
      walkthroughPosted: true,
      walkthroughSkipped: true,
    },
    null,
    2,
  );
  const idleState = JSON.stringify({ sessionId: "s", prsHandled: [], terminalPending: [] }, null, 2);
  const serializedStates = `${armedState}\n${idleState}`;

  const wrapperScriptNames = readdirSync(SCRIPTS).filter(
    (name) => name.startsWith("guardrail-") && name.endsWith(".sh"),
  );

  it.each(wrapperScriptNames)("%s greps only for shapes the state file can hold", (wrapperScriptName) => {
    const wrapperBody = readFileSync(join(SCRIPTS, wrapperScriptName), "utf-8");
    for (const [, statePattern] of wrapperBody.matchAll(/grep -q '([^']+)'/g)) {
      const literal = statePattern.replaceAll("\\[", "[").replaceAll("\\]", "]");
      expect(serializedStates, `${wrapperScriptName} greps for ${literal}`).toContain(literal);
    }
  });
});
