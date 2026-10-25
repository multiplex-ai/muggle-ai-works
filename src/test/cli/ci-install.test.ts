import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { installCiWorkflow } from "../../cli/ci-install";
import { USER_WORKFLOW_PATH } from "../../ci-workflow/constants";
import { renderUserWorkflow } from "../../ci-workflow/template";
import { CiInstallOutcome } from "../../cli/ci-install-types";

const FIRST_RELEASE_WORKFLOW = readFileSync(
  fileURLToPath(new URL("../ci-workflow/fixtures/walkthrough-workflow-first-release.yml", import.meta.url)),
  "utf-8",
);

describe("installCiWorkflow", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "muggle-ci-"));
    mkdirSync(join(repo, ".git"));
  });

  const placeWorkflow = (content: string): void => {
    mkdirSync(join(repo, ".github", "workflows"), { recursive: true });
    writeFileSync(join(repo, USER_WORKFLOW_PATH), content);
  };
  const readWorkflow = (): string => readFileSync(join(repo, USER_WORKFLOW_PATH), "utf-8");

  it("writes the workflow and reports where it landed", () => {
    const report = installCiWorkflow({ cwd: repo, force: false });
    expect(report.outcome).toBe(CiInstallOutcome.Installed);
    expect(readWorkflow()).toBe(renderUserWorkflow());
  });

  it("replaces a copy an earlier release installed, without being forced", () => {
    placeWorkflow(FIRST_RELEASE_WORKFLOW);
    const report = installCiWorkflow({ cwd: repo, force: false });
    expect(report.outcome).toBe(CiInstallOutcome.Updated);
    expect(readWorkflow()).toBe(renderUserWorkflow());
  });

  it("reports a current copy as current and leaves it as it is", () => {
    const currentWithCrlf = renderUserWorkflow().replace(/\n/g, "\r\n");
    placeWorkflow(currentWithCrlf);
    const report = installCiWorkflow({ cwd: repo, force: false });
    expect(report.outcome).toBe(CiInstallOutcome.AlreadyCurrent);
    expect(readWorkflow()).toBe(currentWithCrlf);
  });

  it("leaves an existing workflow alone rather than clobbering a customised one", () => {
    placeWorkflow("name: mine\n");
    const report = installCiWorkflow({ cwd: repo, force: false });
    expect(report.outcome).toBe(CiInstallOutcome.KeptCustomized);
    expect(readWorkflow()).toBe("name: mine\n");
  });

  it("overwrites a customised workflow only when explicitly forced", () => {
    placeWorkflow("name: mine\n");
    const report = installCiWorkflow({ cwd: repo, force: true });
    expect(report.outcome).toBe(CiInstallOutcome.Replaced);
    expect(readWorkflow()).toBe(renderUserWorkflow());
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
