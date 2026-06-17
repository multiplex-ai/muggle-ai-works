import { describe, it, expect } from "vitest";
import { looksLikeE2EReport, evaluateReportPost, type FileReader } from "../../guardrails/reportGate";
import type { HookInput } from "../../guardrails/types";

const bash = (command: string, cwd?: string): HookInput => ({
  tool_name: "Bash",
  tool_input: { command: command },
  cwd: cwd,
});

const noFiles: FileReader = () => null;

describe("looksLikeE2EReport", () => {
  it("flags a structured acceptance report", () => {
    expect(looksLikeE2EReport("## E2E Acceptance Results\n3 passed / 1 failed")).toBe(true);
    expect(looksLikeE2EReport("muggle run:\n3 tests passed, 1 failed")).toBe(true);
    expect(looksLikeE2EReport("E2E:\n- ✅ login\n- ❌ checkout")).toBe(true);
  });
  it("ignores ordinary PR comments", () => {
    expect(looksLikeE2EReport("Rebased on main and fixed the lint error.")).toBe(false);
    expect(looksLikeE2EReport("LGTM, merging once CI is green")).toBe(false);
  });
  it("ignores a vague claim with no results structure", () => {
    expect(looksLikeE2EReport("ran the muggle e2e suite, all good")).toBe(false);
  });
  it("ignores a feature PR description that merely mentions E2E", () => {
    expect(
      looksLikeE2EReport("## Summary\nAdds the E2E enforcement gate for muggle. All unit tests passed."),
    ).toBe(false);
  });
});

describe("evaluateReportPost", () => {
  it("ignores non-Bash tools and non-PR commands", () => {
    expect(evaluateReportPost({ tool_name: "Edit" }, noFiles).deny).toBe(false);
    expect(evaluateReportPost(bash("npm test"), noFiles).deny).toBe(false);
  });

  it("allows ordinary PR comments", () => {
    expect(evaluateReportPost(bash('gh pr comment 5 --body "rebased, ready for review"'), noFiles).deny).toBe(false);
  });

  it("denies a hand-written E2E report posted inline", () => {
    const r = evaluateReportPost(
      bash('gh pr comment 5 --body "## E2E Acceptance Results\n2 passed / 1 failed via muggle"'),
      noFiles,
    );
    expect(r.deny).toBe(true);
    expect(r.reason).toMatch(/build-pr-section/);
  });

  it("allows an inline body carrying the sentinel", () => {
    expect(
      evaluateReportPost(
        bash('gh pr comment 5 --body "<!-- muggle-pr-section:v1 -->\n## E2E Acceptance Results\n2 passed / 1 failed"'),
        noFiles,
      ).deny,
    ).toBe(false);
  });

  it("reads --body-file and denies a hand-written report file", () => {
    const read: FileReader = (p) => (p === "report.md" ? "## E2E Acceptance Results\nmuggle: 1 failed" : null);
    expect(evaluateReportPost(bash("gh pr comment 5 --body-file report.md"), read).deny).toBe(true);
  });

  it("reads --body-file and allows a CLI-rendered report file", () => {
    const read: FileReader = (p) =>
      p === "report.md" ? "<!-- muggle-pr-section:v1 -->\n## E2E Acceptance Results\nmuggle: 1 failed" : null;
    expect(evaluateReportPost(bash("gh pr comment 5 --body-file report.md"), read).deny).toBe(false);
  });

  it("allows the sanctioned jq-from-artifact pipe via the artifact sentinel", () => {
    const artifact = JSON.stringify({
      body: "<!-- muggle-pr-section:v1 -->\n## E2E Acceptance Results\nmuggle: 2 passed",
      comment: "",
    });
    const read: FileReader = (p) => (p === "/tmp/out.json" ? artifact : null);
    const cmd = "jq -r '.body' /tmp/out.json | gh pr comment 5 --body-file -";
    expect(evaluateReportPost(bash(cmd), read).deny).toBe(false);
  });

  it("does not deny an un-inspectable stdin pipe (fails open)", () => {
    // The body comes from a shell var the gate can't see — must not block.
    const cmd = 'printf "%s" "$REPORT" | gh pr comment 5 --body-file -';
    expect(evaluateReportPost(bash(cmd), noFiles).deny).toBe(false);
  });

  it("denies a hand-written report piped via echo (body is in the command)", () => {
    const cmd = 'echo "## E2E Acceptance Results - muggle 1 failed" | gh pr comment 5 --body-file -';
    expect(evaluateReportPost(bash(cmd), noFiles).deny).toBe(true);
  });
});
