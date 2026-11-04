import { describe, it, expect } from "vitest";
import { detectDraftPrCommand, evaluateDraftPr } from "../../guardrails/draftPr";
import type { HookInput } from "../../guardrails/types";

const shell = (command: string, toolName = "Bash"): HookInput => ({
  tool_name: toolName,
  tool_input: { command: command },
});

describe("detectDraftPrCommand", () => {
  const drafts: string[] = [
    "gh pr create --draft --title x --body-file body.md --head feat/x",
    "gh pr create --title x --body-file body.md -d",
    "gh pr create -d --fill",
    "gh pr create --draft=true --fill",
    'cd /repo && gh pr create --title "feat: x" --body-file /tmp/b.md --draft',
    "GH_TOKEN=t gh pr create --fill --draft",
    "gh pr ready 142 --undo",
    "gh pr ready --undo",
    "glab mr create --source-branch b --target-branch main --title x --draft",
    "glab mr create --wip --fill",
    "glab mr update 7 --draft",
    'glab mr create --source-branch b --title "Draft: add checkout" --description x',
    "glab mr create --title 'WIP: add checkout' --fill",
    'glab mr create -t "[Draft] add checkout" --fill',
    'glab mr update 7 --title "(Draft) add checkout"',
    `gh api graphql -f query='mutation { convertPullRequestToDraft(input: {pullRequestId: "PR_x"}) { pullRequest { isDraft } } }'`,
    "gh api --method POST repos/o/r/pulls -f title=x -f head=b -f base=main -F draft=true",
    "gh api --method PATCH repos/o/r/pulls/12 -F draft=true",
  ];

  it.each(drafts)("flags %s", (command) => {
    expect(detectDraftPrCommand(command)).toBe(true);
  });

  const allowed: string[] = [
    "gh pr create --title x --body-file body.md --head feat/x",
    "gh pr create --fill --draft=false",
    'gh pr create --title "Stop opening --draft PRs" --body "never pass -d or --draft"',
    "gh pr create --title 'fix: draft handling' --fill",
    "gh pr ready 142",
    "glab mr update 7 --ready",
    'glab mr create --title "Drafting tool: add export" --fill',
    "glab mr create --fill",
    "gh pr view 12 --json isDraft",
    "gh pr list --draft",
    "grep -rn -- --draft plugin/skills",
    "grep -rn convertPullRequestToDraft src",
    "git branch -d old-branch && gh pr create --fill",
    "gh api repos/o/r/pulls?state=open --jq '.[] | select(.draft == true) | .number'",
    `gh pr create --title x --body "$(cat <<'EOF'\nUse gh pr create --draft only locally\nEOF\n)"`,
  ];

  it.each(allowed)("allows %s", (command) => {
    expect(detectDraftPrCommand(command)).toBe(false);
  });
});

describe("evaluateDraftPr", () => {
  it("denies a draft create with the instruction to re-run without the flag", () => {
    const verdict = evaluateDraftPr(shell("gh pr create --draft --fill"));
    expect(verdict.deny).toBe(true);
    expect(verdict.reason).toMatch(/never opens draft PRs/);
    expect(verdict.reason).toMatch(/gh pr ready/);
  });

  it("denies the same command issued through PowerShell", () => {
    expect(evaluateDraftPr(shell("gh pr create --draft --fill", "PowerShell")).deny).toBe(true);
  });

  it("allows a ready-for-review create", () => {
    expect(evaluateDraftPr(shell("gh pr create --fill"))).toEqual({ deny: false });
  });

  it("ignores non-shell tools", () => {
    expect(
      evaluateDraftPr({ tool_name: "Read", tool_input: { command: "gh pr create --draft" } }),
    ).toEqual({ deny: false });
  });
});
