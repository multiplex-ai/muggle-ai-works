import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { isShellToolCall } from "../../guardrails/shellTool";
import { detectPrOpened } from "../../guardrails/prOpened";
import { evaluateReportPost } from "../../guardrails/reportGate";

const HOOKS = fileURLToPath(new URL("../../../plugin/hooks/hooks.json", import.meta.url));

describe("isShellToolCall", () => {
  it("accepts both shells a session can run commands through", () => {
    expect(isShellToolCall({ tool_name: "Bash" })).toBe(true);
    expect(isShellToolCall({ tool_name: "PowerShell" })).toBe(true);
  });

  it("rejects a tool that carries no shell command", () => {
    expect(isShellToolCall({ tool_name: "Read" })).toBe(false);
    expect(isShellToolCall({})).toBe(false);
  });
});

// Windows sessions run `gh` through the PowerShell tool. Keyed on Bash alone,
// every guard below was blind there: the PR went unrecorded, so no walkthrough
// comment was reserved and no watcher was owed — and the deny gates could be
// walked straight past by running the same command in the other shell.
describe("guards see a command run in either shell", () => {
  it("records a PR opened from PowerShell", () => {
    const opened = detectPrOpened({
      tool_name: "PowerShell",
      tool_input: { command: "gh pr create --title x --body y" },
      tool_response: { stdout: "https://github.com/o/r/pull/7\n" },
    });
    expect(opened).toBe("https://github.com/o/r/pull/7");
  });

  it("denies a hand-written report posted from PowerShell", () => {
    const verdict = evaluateReportPost({
      tool_name: "PowerShell",
      tool_input: { command: 'gh pr comment 7 --body "E2E acceptance: 3 passed, 1 failed"' },
    });
    expect(verdict.deny).toBe(true);
  });
});

// A hook registered only for Bash is never invoked for a PowerShell call, so
// the TypeScript fix above would be unreachable without the matcher.
describe("hooks.json registers the shell guards for both shells", () => {
  it("matches PowerShell wherever it matches Bash", () => {
    const hooks = JSON.parse(readFileSync(HOOKS, "utf-8")) as {
      hooks: Record<string, Array<{ matcher?: string }>>;
    };
    const bashOnly = Object.values(hooks.hooks)
      .flat()
      .filter((entry) => entry.matcher === "Bash");
    expect(bashOnly, "a matcher of exactly \"Bash\" leaves PowerShell unguarded").toEqual([]);
  });
});
