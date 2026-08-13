import { describe, expect, it } from "vitest";
import { findUnsignedPosts, shellLines } from "../../scripts/check-post-signatures.mjs";

const SIGNED = 'body="$(bash "${CLAUDE_PLUGIN_ROOT}/scripts/sign-body.sh" --command /muggle-do --mode loop < draft.md)"';

function fence(...bodyLines) {
  return ["```bash", ...bodyLines, "```"].join("\n");
}

describe("shellLines", () => {
  it("collects only lines inside shell fences", () => {
    const content = ["prose `gh pr comment` mentioned here", fence("gh pr comment 1"), "more prose"].join("\n");
    expect(shellLines(content).map((c) => c.text)).toEqual(["gh pr comment 1"]);
  });

  it("ignores fences that are not shell", () => {
    const content = ["```", "gh pr comment 1", "```"].join("\n");
    expect(shellLines(content)).toEqual([]);
  });

  it("joins backslash-continued lines into one command, reporting the opening line", () => {
    const content = fence("gh api \\", "  --method POST \\", "  -f body=x");
    const commands = shellLines(content);
    expect(commands).toHaveLength(1);
    expect(commands[0].text).toContain("gh api");
    expect(commands[0].text).toContain("--method POST");
    expect(commands[0].line).toBe(2);
  });
});

describe("findUnsignedPosts", () => {
  it("flags a posting command in a file that never signs", () => {
    const violations = findUnsignedPosts("a.md", fence('gh pr comment 1 --body "hi"'));
    expect(violations).toEqual([{ file: "a.md", line: 2, command: "gh pr comment" }]);
  });

  it("passes when the file pipes a body through the signer", () => {
    const content = fence(SIGNED, 'gh pr comment 1 --body "$body"');
    expect(findUnsignedPosts("a.md", content)).toEqual([]);
  });

  it("ignores a command named only in prose", () => {
    const content = "Never call `gh pr comment` from this skill.";
    expect(findUnsignedPosts("a.md", content)).toEqual([]);
  });

  it("ignores reads through the same CLIs", () => {
    const content = fence('gh api "repos/o/r/issues/1/comments" --jq ".[].id"', "gh pr view 1 --json body");
    expect(findUnsignedPosts("a.md", content)).toEqual([]);
  });

  it("catches a write split across continuation lines", () => {
    const content = fence("gh api \\", "  --method POST \\", "  /repos/o/r/pulls/1/comments/2/replies \\", '  -f body="x"');
    expect(findUnsignedPosts("a.md", content)).toEqual([
      { file: "a.md", line: 2, command: "gh api write to a comment" },
    ]);
  });

  it.each([
    ["glab mr note 1 -R g/p -m 'x'", "glab mr note"],
    ["glab mr create -R g/p --description 'x'", "glab mr create"],
    ["glab mr update 1 -R g/p --description 'x'", "glab mr update --description"],
    ["glab api --method POST projects/:id/merge_requests/1/discussions/2/notes", "glab api write to a note"],
    ["gh pr edit 1 --body-file f", "gh pr edit --body"],
    ["gh pr create --title t --body-file f", "gh pr create"],
  ])("flags %s", (command, expected) => {
    const violations = findUnsignedPosts("a.md", fence(command));
    expect(violations).toHaveLength(1);
    expect(violations[0].command).toBe(expected);
  });
});
