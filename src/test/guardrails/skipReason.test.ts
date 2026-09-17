import { describe, it, expect } from "vitest";
import { skipReasonFrom } from "../../guardrails/skipReason";

describe("skipReasonFrom", () => {
  it("reads the reason off an E2E skip declaration", () => {
    expect(skipReasonFrom('echo "MUGGLE_E2E_SKIP: no browser surface in this change"')).toBe(
      "no browser surface in this change",
    );
  });

  it("reads the reason off a walkthrough skip declaration", () => {
    expect(skipReasonFrom("echo 'MUGGLE_WALKTHROUGH_SKIP: someone else's PR'")).toBe(
      "someone else's PR",
    );
  });

  it("ignores a declaration with no reason", () => {
    expect(skipReasonFrom('echo "MUGGLE_E2E_SKIP:"')).toBeNull();
    expect(skipReasonFrom('echo "MUGGLE_E2E_SKIP: "')).toBeNull();
  });

  it("ignores a command that merely mentions the marker", () => {
    expect(skipReasonFrom("grep -r MUGGLE_E2E_SKIP: plugin/")).toBeNull();
  });

  it("ignores an unrelated command", () => {
    expect(skipReasonFrom("pnpm test")).toBeNull();
  });
});
