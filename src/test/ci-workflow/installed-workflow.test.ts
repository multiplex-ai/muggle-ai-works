import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { classifyInstalledWorkflow, hashUserWorkflow } from "../../ci-workflow/installed-workflow";
import { PRIOR_USER_WORKFLOW_SHA256S, USER_WORKFLOW_SHA256 } from "../../ci-workflow/constants";
import { renderUserWorkflow } from "../../ci-workflow/template";
import { InstalledWorkflowState } from "../../ci-workflow/types";

// Byte-identical to the copy the first ci-install wrote into consuming repos.
const FIRST_RELEASE_WORKFLOW = readFileSync(
  fileURLToPath(new URL("./fixtures/walkthrough-workflow-first-release.yml", import.meta.url)),
  "utf-8",
);

describe("classifyInstalledWorkflow", () => {
  it("reports a repository without the file as missing", () => {
    expect(classifyInstalledWorkflow(null)).toBe(InstalledWorkflowState.Missing);
  });

  it("recognises the current rendering", () => {
    expect(classifyInstalledWorkflow(renderUserWorkflow())).toBe(InstalledWorkflowState.Current);
  });

  it("recognises a rendering an earlier release installed as outdated", () => {
    expect(classifyInstalledWorkflow(FIRST_RELEASE_WORKFLOW)).toBe(InstalledWorkflowState.Outdated);
  });

  // A checkout with core.autocrlf rewrites the file on disk without anyone editing it.
  it("ignores line endings when matching a rendering", () => {
    expect(classifyInstalledWorkflow(FIRST_RELEASE_WORKFLOW.replace(/\n/g, "\r\n"))).toBe(
      InstalledWorkflowState.Outdated,
    );
    expect(classifyInstalledWorkflow(renderUserWorkflow().replace(/\n/g, "\r\n"))).toBe(
      InstalledWorkflowState.Current,
    );
  });

  it("treats any edit to a rendering as customised", () => {
    const edited = FIRST_RELEASE_WORKFLOW.replace("runs-on: ubuntu-latest", "runs-on: self-hosted");
    expect(classifyInstalledWorkflow(edited)).toBe(InstalledWorkflowState.Customized);
    expect(classifyInstalledWorkflow("name: mine\n")).toBe(InstalledWorkflowState.Customized);
  });
});

// Every install a release ever wrote must stay recognisable, or a template change
// strands it as "customised" and it never updates again.
describe("the recorded renderings", () => {
  it("record the current template — move the old hash into the prior set when the template changes", () => {
    expect(hashUserWorkflow(renderUserWorkflow())).toBe(USER_WORKFLOW_SHA256);
  });

  it("keep the current rendering out of the prior set", () => {
    expect(PRIOR_USER_WORKFLOW_SHA256S.has(USER_WORKFLOW_SHA256)).toBe(false);
  });

  it("include the first release's rendering", () => {
    expect(PRIOR_USER_WORKFLOW_SHA256S.has(hashUserWorkflow(FIRST_RELEASE_WORKFLOW))).toBe(true);
  });
});
