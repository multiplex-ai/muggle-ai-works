import { describe, expect, it } from "vitest";

import { FAILED_RUN_TRACE_ARGS_CHARS, FAILED_RUN_TRACE_MAX_ATTEMPTS } from "../src/constants.js";
import { formatFailedRunTrace } from "../src/failed-run-trace.js";
import type { AgentRunVerdict, ToolAttempt } from "../src/types.js";

const verdictOf = (pass: boolean, toolAttempts: ToolAttempt[], finalOutput = ""): AgentRunVerdict => ({
  scenario: "s",
  pass: pass,
  reasons: pass ? [] : ["missed"],
  trace: { finalOutput: finalOutput, toolAttempts: toolAttempts, askQuestionCount: 0 },
});

describe("formatFailedRunTrace", () => {
  it("prints nothing for a passing run or one aborted before any attempt", () => {
    expect(formatFailedRunTrace(verdictOf(true, [{ tool: "Bash", args: { command: "ls" } }]))).toEqual([]);
    expect(formatFailedRunTrace(verdictOf(false, []))).toEqual([]);
  });

  it("lists each attempt by command, or by file and what was written into it, on one line", () => {
    const lines = formatFailedRunTrace(
      verdictOf(
        false,
        [
          { tool: "Bash", args: { command: "cd ~/s &&\necho done >> iterations/001.md" } },
          { tool: "Write", args: { file_path: "/s/requirements.md", content: "# Goal\nship it" } },
          { tool: "Skill", args: { skill: "muggle-do" } },
        ],
        "Stage 2\ncomplete",
      ),
    );
    expect(lines).toEqual([
      "  trace: 3 attempts, last 3 shown",
      "  #1 Bash cd ~/s && ⏎ echo done >> iterations/001.md",
      "  #2 Write /s/requirements.md ← # Goal ⏎ ship it",
      '  #3 Skill {"skill":"muggle-do"}',
      "  final: Stage 2 ⏎ complete",
    ]);
  });

  it("keeps only the latest attempts and truncates long inputs", () => {
    const attempts = Array.from({ length: FAILED_RUN_TRACE_MAX_ATTEMPTS + 5 }, (_, index) => ({
      tool: "Bash",
      args: { command: `step-${index} ${"x".repeat(FAILED_RUN_TRACE_ARGS_CHARS)}` },
    }));
    const lines = formatFailedRunTrace(verdictOf(false, attempts));
    expect(lines[0]).toBe(`  trace: ${attempts.length} attempts, last ${FAILED_RUN_TRACE_MAX_ATTEMPTS} shown`);
    expect(lines[1]).toMatch(/^ {2}#6 Bash step-5 x+…$/);
    expect(lines).toHaveLength(FAILED_RUN_TRACE_MAX_ATTEMPTS + 1);
  });
});
