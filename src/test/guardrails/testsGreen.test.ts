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

  it("treats a failed run as not green and a passing run as green", () => {
    expect(testsPassed({ tool_response: { stdout: "Tests: 3 failed, 1 passed" } })).toBe(false);
    expect(testsPassed({ tool_response: { stdout: "FAIL src/foo.test.ts" } })).toBe(false);
    expect(testsPassed({ tool_response: { stdout: "Tests: 18 passed", stderr: "" } })).toBe(true);
    expect(testsPassed({ tool_response: { stdout: "" } })).toBe(false);
  });

  it("counts a muggle execute/replay MCP tool call as an E2E run", () => {
    expect(isE2ERun({ tool_name: "muggle-local-execute-replay" })).toBe(true);
    expect(isE2ERun({ tool_name: "muggle-local-execute-test-generation" })).toBe(true);
    expect(
      isE2ERun({ tool_name: "mcp__plugin_muggle_muggle__muggle-remote-workflow-start-test-script-replay" }),
    ).toBe(true);
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
