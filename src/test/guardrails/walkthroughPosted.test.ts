import { describe, it, expect } from "vitest";
import {
  detectWalkthroughPost,
  isWalkthroughSkipMarker,
  applyWalkthroughPosted,
  applyWalkthroughSkip,
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

  it("returns the same reference when nothing changed", () => {
    expect(applyWalkthroughPosted(base, false)).toBe(base);
    expect(applyWalkthroughSkip(base, false)).toBe(base);
    const posted = { ...base, walkthroughPosted: true };
    expect(applyWalkthroughPosted(posted, true)).toBe(posted);
  });

  it("records the post and the skip", () => {
    expect(applyWalkthroughPosted(base, true).walkthroughPosted).toBe(true);
    expect(applyWalkthroughSkip(base, true).walkthroughSkipped).toBe(true);
  });
});
