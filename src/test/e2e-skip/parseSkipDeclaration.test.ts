import { describe, it, expect } from "vitest";
import { judgeSkipDeclaration } from "../../e2e-skip/parseSkipDeclaration";
import { E2eSkipCode, SkipRejection } from "../../e2e-skip/types";

describe("judgeSkipDeclaration", () => {
  it("accepts a declaration citing a known code, keeping the detail", () => {
    expect(judgeSkipDeclaration('echo "MUGGLE_E2E_SKIP: NO_WEB_SURFACE: ships hooks and a CLI"')).toEqual({
      accepted: true,
      skip: { code: E2eSkipCode.NoWebSurface, detail: "ships hooks and a CLI" },
    });
  });

  it("accepts a code with no detail", () => {
    expect(judgeSkipDeclaration('echo "MUGGLE_E2E_SKIP: NO_PR"')).toEqual({
      accepted: true,
      skip: { code: E2eSkipCode.NoPr, detail: "" },
    });
  });

  it("rejects prose that names no code", () => {
    const judged = judgeSkipDeclaration('echo "MUGGLE_E2E_SKIP: no browser surface in this change"');
    expect(judged).toEqual({
      accepted: false,
      rejection: SkipRejection.UnknownCode,
      claimedCode: "no",
    });
  });

  // The exact excuse from muggle-ai-ui#613. It cleared the old gate because the
  // only test was that the string was non-empty.
  it("rejects a verified-another-way justification", () => {
    const judged = judgeSkipDeclaration(
      'echo "MUGGLE_E2E_SKIP: verified instead with puppeteer-core against the local dev server"',
    );
    expect(judged?.accepted).toBe(false);
  });

  it("rejects a declaration with no reason at all", () => {
    expect(judgeSkipDeclaration('echo "MUGGLE_E2E_SKIP:"')).toEqual({
      accepted: false,
      rejection: SkipRejection.MissingCode,
    });
  });

  it("ignores a command that merely mentions the marker", () => {
    expect(judgeSkipDeclaration("grep -r MUGGLE_E2E_SKIP: plugin/")).toBeNull();
    expect(judgeSkipDeclaration('grep -rn "MUGGLE_E2E_SKIP" src/')).toBeNull();
    expect(judgeSkipDeclaration("git commit -m 'add MUGGLE_E2E_SKIP marker'")).toBeNull();
    expect(judgeSkipDeclaration('gh pr create --title "MUGGLE_E2E_SKIP support"')).toBeNull();
  });

  // The declaration has to be the command, not a tail of one, or any command
  // could carry a skip past the gate as a suffix.
  it("ignores a declaration chained onto another command", () => {
    expect(judgeSkipDeclaration('cat file && echo "MUGGLE_E2E_SKIP: NO_PR"')).toBeNull();
  });

  it("accepts a declaration with leading whitespace and no quotes", () => {
    expect(judgeSkipDeclaration("  echo MUGGLE_E2E_SKIP: EMPTY_DIFF")).toEqual({
      accepted: true,
      skip: { code: E2eSkipCode.EmptyDiff, detail: "" },
    });
  });

  it("ignores an unrelated command", () => {
    expect(judgeSkipDeclaration("pnpm test")).toBeNull();
  });

  // A walkthrough skip governs whether a result is posted, not whether the run
  // happened, so it must never register as an E2E skip.
  it("ignores a walkthrough skip declaration", () => {
    expect(judgeSkipDeclaration("echo 'MUGGLE_WALKTHROUGH_SKIP: someone else's PR'")).toBeNull();
  });
});
