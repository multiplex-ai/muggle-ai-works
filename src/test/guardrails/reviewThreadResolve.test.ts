import { describe, it, expect } from "vitest";
import {
  detectResolveCall,
  evaluateReviewThreadResolve,
} from "../../guardrails/reviewThreadResolve";
import { ReviewThreadProvider, type HookInput } from "../../guardrails/types";

const bash = (command: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: command },
});

// Lifted verbatim from the sessions that resolved threads on muggle-ai-brain#161
// and muggle-ai-prompt-service#729. Whatever else changes, these exact strings
// must stay denied.
const OBSERVED_GITHUB_RESOLVES = [
  `gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_kwDORv5DzM6ZebKZ"}) { thread { isResolved } } }' --jq '.data.resolveReviewThread.thread.isResolved'`,
  `gh api graphql -f query='mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ id isResolved } } }' -f id="PRRT_kwDORv5DzM6b_o_a"`,
];

describe("detectResolveCall", () => {
  it.each(OBSERVED_GITHUB_RESOLVES)("names GitHub for a real resolve (%#)", (command) => {
    expect(detectResolveCall(command)).toBe(ReviewThreadProvider.GitHub);
  });

  it("names GitLab for the discussions resolve PUT", () => {
    expect(
      detectResolveCall(
        "glab api --method PUT 'projects/:id/merge_requests/7/discussions/abc123?resolved=true'",
      ),
    ).toBe(ReviewThreadProvider.GitLab);
  });

  it("allows the inverse calls that re-open a thread", () => {
    expect(
      detectResolveCall(`gh api graphql -f query='mutation{unresolveReviewThread(input:{threadId:"T"}){thread{id}}}'`),
    ).toBeNull();
    expect(
      detectResolveCall("glab api --method PUT 'projects/:id/merge_requests/7/discussions/abc?resolved=false'"),
    ).toBeNull();
  });

  it("allows reads that merely name the mutation", () => {
    expect(detectResolveCall("grep -rn resolveReviewThread plugin/skills")).toBeNull();
    expect(detectResolveCall("cat docs/why-we-never-call-resolveReviewThread.md")).toBeNull();
  });

  it("allows the thread fetch the round legitimately runs", () => {
    expect(
      detectResolveCall(
        `gh api graphql -f query='query{repository(owner:"o",name:"r"){pullRequest(number:1){reviewThreads(first:100){nodes{id isResolved}}}}}'`,
      ),
    ).toBeNull();
  });

  it("allows the threaded reply that should happen instead", () => {
    expect(
      detectResolveCall(
        "gh api --method POST repos/o/r/pulls/1/comments/99/replies -f body='Addressed in c420798'",
      ),
    ).toBeNull();
  });
});

describe("evaluateReviewThreadResolve", () => {
  it("ignores non-Bash tools", () => {
    expect(evaluateReviewThreadResolve({ tool_name: "Edit" }).deny).toBe(false);
    expect(evaluateReviewThreadResolve({}).deny).toBe(false);
  });

  it("denies both providers with one rule", () => {
    expect(evaluateReviewThreadResolve(bash(OBSERVED_GITHUB_RESOLVES[0])).deny).toBe(true);
    expect(
      evaluateReviewThreadResolve(
        bash("glab api --method PUT 'projects/9/merge_requests/7/discussions/abc?resolved=true'"),
      ).deny,
    ).toBe(true);
  });

  it("points the denial at the reply that retires the thread", () => {
    const verdict = evaluateReviewThreadResolve(bash(OBSERVED_GITHUB_RESOLVES[1]));
    expect(verdict.reason).toContain("muggle-do:bot");
    expect(verdict.reason).toContain("reviewer");
  });

  it("leaves an ordinary command alone", () => {
    expect(evaluateReviewThreadResolve(bash("npm test")).deny).toBe(false);
    expect(evaluateReviewThreadResolve(bash("gh pr view 12 --json reviewThreads")).deny).toBe(false);
  });
});
