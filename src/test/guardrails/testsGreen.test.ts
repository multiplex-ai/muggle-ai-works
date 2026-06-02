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

  it("detects a muggle E2E run", () => {
    expect(isE2ERun({ tool_input: { command: "muggle test --local" } })).toBe(true);
    expect(isE2ERun({ tool_name: "muggle-local-execute-test-generation" })).toBe(true);
    expect(isE2ERun({ tool_input: { command: "pnpm test" } })).toBe(false);
  });
});
