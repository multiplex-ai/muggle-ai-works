import { describe, it, expect } from "vitest";
import { isTestCommand, testsPassed, isE2ERun } from "../../guardrails/testsGreen";

describe("testsGreen", () => {
  it("recognizes common test commands", () => {
    expect(isTestCommand("pnpm test")).toBe(true);
    expect(isTestCommand("npx jest src/foo")).toBe(true);
    expect(isTestCommand("vitest run")).toBe(true);
    expect(isTestCommand("go test ./...")).toBe(true);
    expect(isTestCommand("git status")).toBe(false);
  });

  it.each([
    "npm run test",
    "yarn test",
    "pnpm test:unit",
    "pnpm vitest run src/test/guardrails",
    "pnpm exec vitest run src/test/guardrails/testsGreen.test.ts",
    "npx --yes vitest run",
    "./node_modules/.bin/vitest run",
    "cargo test",
    "pytest -q",
    "python -m pytest tests/",
    "CI=true pnpm test",
    "cd /c/Users/x/muggle-ai-works && pnpm test 2>&1 | tail -20",
    "(cd internal/agent-gate-eval && pnpm test)",
    'Set-Location C:\\wt; $env:PATH = "C:\\Program Files\\Git\\bin;" + $env:PATH\npnpm exec vitest run src/test/scripts 2>&1 | Select-Object -Last 4',
    'node "C:/plugin/scripts/guard-run.mjs" -- pnpm vitest run',
    'bash -c "pnpm test"',
  ])("counts a command that runs a test suite: %s", (command) => {
    expect(isTestCommand(command)).toBe(true);
  });

  // Observed 2026-10-20: a read-only subagent's `cat vitest.config.*` matched the
  // runner name, printed no failure, and flipped unitTestsGreen for the session.
  it.each([
    "cd /c/works && head -40 src/report.ts; echo ---; cat vitest.config.* 2>/dev/null | head -40",
    "grep -rn vitest package.json",
    "rg -n 'jest|vitest' src",
    'git commit -m "fix: pnpm test passes again"',
    "ls node_modules/.bin/vitest",
    "pnpm add -D vitest",
    "Get-Content vitest.config.ts",
  ])("ignores a command that only mentions a test runner: %s", (command) => {
    expect(isTestCommand(command)).toBe(false);
  });

  it("treats a failed run as not green and a passing run as green", () => {
    expect(testsPassed({ tool_response: { stdout: "Tests: 3 failed, 1 passed" } })).toBe(false);
    expect(testsPassed({ tool_response: { stdout: "FAIL src/foo.test.ts" } })).toBe(false);
    expect(testsPassed({ tool_response: { stdout: "Tests: 18 passed", stderr: "" } })).toBe(true);
    expect(testsPassed({ tool_response: { stdout: "" } })).toBe(false);
  });

  // Codex reports combined output as one string, normalized to `output`.
  it("judges a host's combined output the same way", () => {
    expect(testsPassed({ tool_response: { output: "Tests  18 passed (18)" } })).toBe(true);
    expect(testsPassed({ tool_response: { output: "Tests  1 failed | 17 passed (18)" } })).toBe(false);
  });

  it("counts a muggle execute/replay MCP tool call as an E2E run", () => {
    expect(isE2ERun({ tool_name: "muggle-local-execute-replay" })).toBe(true);
    expect(isE2ERun({ tool_name: "muggle-local-execute-test-generation" })).toBe(true);
    expect(
      isE2ERun({ tool_name: "mcp__plugin_muggle_muggle__muggle-remote-workflow-start-test-script-replay" }),
    ).toBe(true);
    expect(
      isE2ERun({ tool_name: "mcp__plugin_muggle_muggle__muggle-remote-workflow-start-test-script-replay-bulk" }),
    ).toBe(true);
    expect(isE2ERun({ tool_name: "mcp__muggle__muggle_local_execute_test_generation" })).toBe(true);
  });

  it.each([
    "muggle-remote-wf-get-ts-replay-latest-run",
    "muggle-remote-wf-get-ts-replay-bulk-latest-run",
    "muggle-remote-wf-get-replay-bulk-batch-summary",
    "muggle-remote-wf-list-ts-replay-bulk-runtimes",
    "muggle-local-run-result-get",
    "muggle-local-cancel-execution",
  ])("never counts a read-only lookup as an E2E run: %s", (serverToolName) => {
    expect(isE2ERun({ tool_name: `mcp__plugin_muggle_muggle__${serverToolName}` })).toBe(false);
    expect(isE2ERun({ tool_name: `mcp__muggle__${serverToolName.replaceAll("-", "_")}` })).toBe(false);
  });

  it("counts the muggle-test skill's own telemetry emit as an E2E run (clean SKIP included)", () => {
    expect(
      isE2ERun({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit",
        tool_input: { skillName: "muggle-test" },
      }),
    ).toBe(true);
  });

  it("ignores telemetry emits from other skills", () => {
    const emit = (skillName: string) =>
      isE2ERun({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit",
        tool_input: { skillName: skillName },
      });
    expect(emit("muggle-do")).toBe(false);
    expect(emit("muggle-pr-followup")).toBe(false);
    expect(emit("muggle-test-prepare")).toBe(false);
    expect(
      isE2ERun({ tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit" }),
    ).toBe(false);
  });

  it("never counts a Bash command as an E2E run, even one naming muggle + test", () => {
    const bash = (command: string) => isE2ERun({ tool_name: "Bash", tool_input: { command } });
    expect(bash("git commit -m 'feat: muggle e2e test gate'")).toBe(false);
    expect(bash("gh pr create --title 'muggle lane-aware test-script-list'")).toBe(false);
    expect(bash("grep -rn muggle src/test/")).toBe(false);
    expect(bash("cd /c/Users/x/muggle-ai-works && npm test")).toBe(false);
    expect(bash("muggle test --local")).toBe(false);
    expect(bash("pnpm test")).toBe(false);
  });

});
