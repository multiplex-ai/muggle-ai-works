import { describe, it, expect } from "vitest";
import { detectPrOpened } from "../../guardrails/prOpened";

describe("detectPrOpened", () => {
  it("extracts the PR url from a successful gh pr create", () => {
    expect(
      detectPrOpened({
        tool_name: "Bash",
        tool_input: { command: "gh pr create --title x --body y" },
        tool_response: { stdout: "https://github.com/multiplex-ai/muggle-ai-ui/pull/342\n" },
      }),
    ).toBe("https://github.com/multiplex-ai/muggle-ai-ui/pull/342");
  });

  it("ignores non-PR-create Bash calls", () => {
    expect(
      detectPrOpened({
        tool_name: "Bash",
        tool_input: { command: "gh pr view 342" },
        tool_response: { stdout: "https://github.com/o/r/pull/342" },
      }),
    ).toBeNull();
  });

  it("ignores a create call with no url in output (failed)", () => {
    expect(
      detectPrOpened({
        tool_name: "Bash",
        tool_input: { command: "gh pr create --fill" },
        tool_response: { stderr: "pull request create failed" },
      }),
    ).toBeNull();
  });

  it("detects gh pr ready (draft → open)", () => {
    expect(
      detectPrOpened({
        tool_name: "Bash",
        tool_input: { command: "gh pr ready 19" },
        tool_response: { stdout: "https://github.com/o/r/pull/19" },
      }),
    ).toBe("https://github.com/o/r/pull/19");
  });

  it("ignores non-Bash tools", () => {
    expect(
      detectPrOpened({
        tool_name: "Edit",
        tool_input: { command: "gh pr create" },
        tool_response: { stdout: "https://github.com/o/r/pull/1" },
      }),
    ).toBeNull();
  });
});
