import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { installCiWorkflow } from "../../cli/ci-install";
import { USER_WORKFLOW_PATH } from "../../ci-workflow/constants";
import { renderUserWorkflow } from "../../ci-workflow/template";
import { CiInstallOutcome } from "../../cli/ci-install-types";

describe("installCiWorkflow", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "muggle-ci-"));
    mkdirSync(join(repo, ".git"));
  });

  it("writes the workflow and reports where it landed", () => {
    const report = installCiWorkflow({ cwd: repo, force: false });
    expect(report.outcome).toBe(CiInstallOutcome.Installed);
    expect(readFileSync(join(repo, USER_WORKFLOW_PATH), "utf-8")).toBe(renderUserWorkflow());
  });

  it("leaves an existing workflow alone rather than clobbering a customised one", () => {
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repo, USER_WORKFLOW_PATH), "name: mine\n");
    const report = installCiWorkflow({ cwd: repo, force: false });
    expect(report.outcome).toBe(CiInstallOutcome.AlreadyPresent);
    expect(readFileSync(join(repo, USER_WORKFLOW_PATH), "utf-8")).toBe("name: mine\n");
  });

  it("overwrites only when explicitly forced", () => {
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repo, USER_WORKFLOW_PATH), "name: mine\n");
    const report = installCiWorkflow({ cwd: repo, force: true });
    expect(report.outcome).toBe(CiInstallOutcome.Installed);
    expect(readFileSync(join(repo, USER_WORKFLOW_PATH), "utf-8")).toBe(renderUserWorkflow());
  });

  // Writing a workflow into a directory that is not a repository is how a
  // stray .github lands in someone's home folder.
  it("refuses outside a git repository", () => {
    const loose = mkdtempSync(join(tmpdir(), "muggle-loose-"));
    const report = installCiWorkflow({ cwd: loose, force: false });
    expect(report.outcome).toBe(CiInstallOutcome.NotARepository);
    expect(existsSync(join(loose, USER_WORKFLOW_PATH))).toBe(false);
  });
});
