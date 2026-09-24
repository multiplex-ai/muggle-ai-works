import { describe, it, expect } from "vitest";
import { evaluateWalkthroughHeadingPost } from "../../guardrails/walkthroughHeadingGate";
import { WALKTHROUGH_COMMENT_HEADING, WALKTHROUGH_SLOT_MARKER } from "../../pr-walkthrough/constants";
import type { GuardrailState, HookInput } from "../../guardrails/types";

const stateWith = (overrides: Partial<GuardrailState> = {}): GuardrailState => ({
  sessionId: "s",
  prsHandled: [],
  ...overrides,
});

const post = (body: string, toolName = "Bash"): HookInput => ({
  tool_name: toolName,
  tool_input: { command: `gh pr comment 613 --body ${JSON.stringify(body)}` },
});

// The comment from muggle-ai-ui#613: it wears the heading, describes another
// tool's findings, and carries no report structure for the report gate to catch.
const IMPERSONATING_BODY =
  `${WALKTHROUGH_COMMENT_HEADING}\n\nE2E skipped — verified instead with puppeteer-core driving ` +
  `installed Chrome against the local dev server.`;

describe("evaluateWalkthroughHeadingPost", () => {
  it("denies a comment wearing the heading when no run was recorded", () => {
    const verdict = evaluateWalkthroughHeadingPost(post(IMPERSONATING_BODY), stateWith());
    expect(verdict.deny).toBe(true);
    expect(verdict.reason).toContain("no Muggle acceptance run has been recorded");
  });

  it("denies the same command issued through PowerShell", () => {
    const verdict = evaluateWalkthroughHeadingPost(
      post(IMPERSONATING_BODY, "PowerShell"),
      stateWith(),
    );
    expect(verdict.deny).toBe(true);
  });

  it("denies a comment carrying only the slot marker", () => {
    const verdict = evaluateWalkthroughHeadingPost(
      post(`${WALKTHROUGH_SLOT_MARKER}\n\nlooks fine to me`),
      stateWith(),
    );
    expect(verdict.deny).toBe(true);
  });

  it("allows the heading once a run has been recorded", () => {
    const verdict = evaluateWalkthroughHeadingPost(
      post(IMPERSONATING_BODY),
      stateWith({ e2eRun: true }),
    );
    expect(verdict.deny).toBe(false);
  });

  // Other-tool proof is welcome on a PR; it just may not wear Muggle's name.
  it("allows the same findings posted without the Muggle heading", () => {
    const verdict = evaluateWalkthroughHeadingPost(
      post("Checked with puppeteer: no console errors, no horizontal overflow."),
      stateWith(),
    );
    expect(verdict.deny).toBe(false);
  });

  it("ignores a command that is not a PR post", () => {
    const verdict = evaluateWalkthroughHeadingPost(
      { tool_name: "Bash", tool_input: { command: `echo ${JSON.stringify(IMPERSONATING_BODY)}` } },
      stateWith(),
    );
    expect(verdict.deny).toBe(false);
  });

  it("ignores a non-shell tool call", () => {
    const verdict = evaluateWalkthroughHeadingPost(
      { tool_name: "Read", tool_input: { command: `gh pr comment 613 --body "${WALKTHROUGH_SLOT_MARKER}"` } },
      stateWith(),
    );
    expect(verdict.deny).toBe(false);
  });
});
