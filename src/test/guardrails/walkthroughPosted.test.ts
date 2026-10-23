import { describe, it, expect } from "vitest";
import {
  detectWalkthroughPost,
  isWalkthroughSkipMarker,
  applyWalkthroughPosted,
  applyWalkthroughSkip,
  detectWalkthroughPostTargets,
} from "../../guardrails/walkthroughPosted";
import type { FileReader } from "../../guardrails/prReportPost";
import type { GuardrailState, HookInput } from "../../guardrails/types";

const SENTINEL_BODY = "<!-- muggle-pr-section:v1 -->\n## E2E Acceptance Results";

function bashInput(command: string): HookInput {
  return { tool_name: "Bash", tool_input: { command: command } };
}

const noFiles: FileReader = () => null;

describe("isWalkthroughSkipMarker", () => {
  it("recognises the declaration", () => {
    expect(isWalkthroughSkipMarker('echo "MUGGLE_WALKTHROUGH_SKIP: no PR"')).toBe(true);
  });

  it("ignores a mere mention, so a grep or commit can't disarm the gate", () => {
    expect(isWalkthroughSkipMarker('grep -r "MUGGLE_WALKTHROUGH_SKIP" src/')).toBe(false);
    expect(isWalkthroughSkipMarker('git commit -m "document MUGGLE_WALKTHROUGH_SKIP"')).toBe(false);
  });
});

describe("detectWalkthroughPost", () => {
  it("registers a sentinel-carrying comment posted inline", () => {
    expect(detectWalkthroughPost(bashInput(`gh pr comment 7 --body '${SENTINEL_BODY}'`), noFiles)).toBe(true);
  });

  it("registers a walkthrough embedded in a new PR's description", () => {
    expect(detectWalkthroughPost(bashInput(`gh pr create --body '${SENTINEL_BODY}'`), noFiles)).toBe(true);
  });

  it("registers a body passed by file", () => {
    const read: FileReader = (path) => (path === "section.md" ? SENTINEL_BODY : null);
    expect(detectWalkthroughPost(bashInput("gh pr comment 7 --body-file section.md"), read)).toBe(true);
  });

  it("registers the jq'd renderer artifact", () => {
    const read: FileReader = (path) =>
      path === "/tmp/muggle-pr-section.json" ? JSON.stringify({ body: SENTINEL_BODY }) : null;
    const cmd = "jq -r '.body' /tmp/muggle-pr-section.json | gh pr comment 7 --body-file -";
    expect(detectWalkthroughPost(bashInput(cmd), read)).toBe(true);
  });

  it("registers an edit of an existing comment — the rerun update path", () => {
    const cmd = `gh api --method PATCH repos/o/r/issues/comments/42 -f body='${SENTINEL_BODY}'`;
    expect(detectWalkthroughPost(bashInput(cmd), noFiles)).toBe(true);
  });

  it("ignores an ordinary PR comment", () => {
    expect(detectWalkthroughPost(bashInput('gh pr comment 7 --body "lgtm"'), noFiles)).toBe(false);
  });

  it("ignores a non-publishing command that merely contains the sentinel", () => {
    expect(detectWalkthroughPost(bashInput("grep -r muggle-pr-section src/"), noFiles)).toBe(false);
  });

  it("ignores non-Bash tool calls", () => {
    expect(detectWalkthroughPost({ tool_name: "Read" }, noFiles)).toBe(false);
  });
});

describe("state reducers", () => {
  const base: GuardrailState = { sessionId: "s", prsHandled: [] };

  const PR_A = "https://github.com/o/r/pull/1";
  const PR_B = "https://github.com/o/r/pull/2";

  it("returns the same reference when nothing changed", () => {
    expect(applyWalkthroughPosted(base, false, 5, [PR_A])).toBe(base);
    expect(applyWalkthroughSkip(base, false)).toBe(base);
  });

  it("settles the PRs a post reached, once each, and the skip", () => {
    const posted = applyWalkthroughPosted(applyWalkthroughPosted(base, true, 5, [PR_A]), true, 6, [PR_A, PR_B]);
    expect(posted.walkthroughPostedPrUrls).toEqual([PR_A, PR_B]);
    expect(posted.walkthroughPostedAt).toBeUndefined();
    expect(applyWalkthroughSkip(base, true).walkthroughSkipped).toBe(true);
  });

  it("timestamps a post whose output names no PR, so only a later scan decides", () => {
    const posted = applyWalkthroughPosted(base, true, 5, []);
    expect(posted.walkthroughPostedAt).toBe(5);
    expect(posted.walkthroughPostedPrUrls).toBeUndefined();
  });

  it("never marks the walkthrough verified — one post settles only the PR it reached", () => {
    expect(applyWalkthroughPosted(base, true, 5, [PR_A]).walkthroughsVerified).toBeUndefined();
  });
});

describe("detectWalkthroughPostTargets", () => {
  const posted = (stdout: string): HookInput => ({
    tool_name: "Bash",
    tool_input: { command: "gh pr comment 7 --body-file w.md" },
    tool_response: { stdout: stdout },
  });

  it("reads the PR from the comment URL gh pr comment prints", () => {
    expect(detectWalkthroughPostTargets(posted("https://github.com/o/r/pull/7#issuecomment-99\n"))).toEqual([
      "https://github.com/o/r/pull/7",
    ]);
  });

  it("reads the PR from a gh api comment edit's html_url", () => {
    const patched = '{"id":99,"html_url":"https://github.com/o/r/pull/7#issuecomment-99","issue_url":"https://api.github.com/repos/o/r/issues/7"}';
    expect(detectWalkthroughPostTargets(posted(patched))).toEqual(["https://github.com/o/r/pull/7"]);
  });

  it("names nothing when the output carries no PR URL", () => {
    expect(detectWalkthroughPostTargets(posted(""))).toEqual([]);
  });

  it("ignores PRs the command quotes, which a body may do for a sibling change", () => {
    const quoting: HookInput = {
      tool_name: "Bash",
      tool_input: { command: 'gh pr comment 7 --body "see https://github.com/o/r/pull/8"' },
      tool_response: { stdout: "https://github.com/o/r/pull/7#issuecomment-1" },
    };
    expect(detectWalkthroughPostTargets(quoting)).toEqual(["https://github.com/o/r/pull/7"]);
  });
});
