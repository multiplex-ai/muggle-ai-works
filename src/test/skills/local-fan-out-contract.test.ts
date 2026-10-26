/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins the local fan-out. A test case whose local lane has several runSettings records runs once per record,
 * in the order the backend plan returns, and the others wait on the primary when the plan says they do. The
 * plan call lives in one shared step of the dev loop; the local skills point at it rather than restate it,
 * and every result carries its record so the walkthrough keeps two resolutions of one test case apart.
 *
 * Prose is the implementation here. These assertions do NOT catch an agent that reads the step and ignores it.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { headingAnchors, sectionBody } from "./helpers/markdown-sections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "plugin", "skills");
const DEV_LOOP_DIR = path.join(SKILLS_DIR, "_shared", "dev-loop");

const read = (...segments: string[]): string => fs.readFileSync(path.join(...segments), "utf8");

const listMarkdownFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(entryPath);
    return entry.name.endsWith(".md") ? [entryPath] : [];
  });

/** A bold-labelled block of the E2E acceptance report (`**Passed:** (count)`), up to the next one. */
const reportBlock = (reportOutput: string, blockLabel: string): string => {
  const blockStart = reportOutput.indexOf(`**${blockLabel}:**`);
  if (blockStart === -1) return "";
  const nextBlockOffset = reportOutput.slice(blockStart + 1).search(/^\*\*\w+:\*\*/m);
  return nextBlockOffset === -1 ? reportOutput.slice(blockStart) : reportOutput.slice(blockStart, blockStart + 1 + nextBlockOffset);
};

const FAN_OUT_PLAN_TOOL = "muggle-remote-fan-out-plan";
const RECORDS_STEP_LINK = "../_shared/dev-loop/run.md#records";

const RUN_DOC = read(DEV_LOOP_DIR, "run.md");
const FAILURES_DOC = read(DEV_LOOP_DIR, "failures.md");
const EXECUTE_LOCAL_DOC = read(SKILLS_DIR, "muggle-test", "execute-local.md");
const FEATURE_LOCAL_DOC = read(SKILLS_DIR, "muggle-test-feature-local", "SKILL.md");
const E2E_ACCEPTANCE_DOC = read(SKILLS_DIR, "do", "e2e-acceptance.md");
const E2E_REPAIR_DOC = read(SKILLS_DIR, "do", "e2e-repair.md");
const REPORT_ASSEMBLY_DOC = read(SKILLS_DIR, "muggle-pr-visual-walkthrough", "e2e-report-assembly.md");
const TOOL_REGISTRY_SOURCE = read(REPO_ROOT, "packages", "mcps", "src", "mcp", "tools", "e2e", "tool-registry.ts");

const recordsStep = sectionBody(RUN_DOC, /^## Records$/m);
const acceptanceRunStep = sectionBody(E2E_ACCEPTANCE_DOC, /^### Step 4:.*$/m);
const acceptanceOutput = sectionBody(E2E_ACCEPTANCE_DOC, /^## Output$/m);
const executeLocalOutput = sectionBody(EXECUTE_LOCAL_DOC, /^## Output$/m);

describe("parser sanity: refuse to pass vacuously", () => {
  it("finds every section under test", () => {
    for (const [name, body] of Object.entries({
      recordsStep: recordsStep,
      acceptanceRunStep: acceptanceRunStep,
      acceptanceOutput: acceptanceOutput,
      executeLocalOutput: executeLocalOutput,
    })) {
      expect(body.length, `section not found or empty: ${name}`).toBeGreaterThan(100);
    }
  });

  it("names a tool the MCP registers", () => {
    expect(TOOL_REGISTRY_SOURCE).toContain(`name: "${FAN_OUT_PLAN_TOOL}"`);
  });
});

describe("the dev loop plans a local fan-out", () => {
  it("asks the backend for the local lane's plan before the first run", () => {
    expect(recordsStep).toContain(`call \`${FAN_OUT_PLAN_TOOL}\` with \`projectId\`, \`testCaseId\` and \`runEnvironmentType: "local"\``);
  });

  it("keeps a single run when the plan has no records", () => {
    expect(recordsStep).toMatch(/\*\*`records` empty\*\* — one run, as the Sequence below describes/);
  });

  it("runs the records in plan order, replaying a record's script or generating its record", () => {
    expect(recordsStep).toContain("one run per record, in `records` order");
    expect(recordsStep).toMatch(/a record with a `testScriptId` → the Replay branch with that id/);
    expect(recordsStep).toMatch(
      /a record without a `testScriptId` → the Regen branch, passing the record's `runSettingsId` and `displayResolution`/,
    );
  });

  it("holds the rest when the primary's run did not pass, and reports them skipped", () => {
    expect(recordsStep).toMatch(/when `isSecondaryGatedOnPrimary` is true, read the first record's run/);
    expect(recordsStep).toMatch(/A `Status` other than `passed` → run none of the rest/);
    expect(recordsStep).toContain('`status: "skipped"`, `reason: "primary failed"`');
    expect(recordsStep).toMatch(/never goes through failure handling/);
  });

  it("carries each run's record into its result", () => {
    expect(recordsStep).toMatch(/`runSettingsId` is the run result's `cloudRunSettingsId`/);
    expect(FAILURES_DOC).toMatch(/`runSettingsId` from the `cloudRunSettingsId` the result prints as `\*\*Cloud Run Settings ID:\*\*`/);
  });

  it("exposes the step under the anchor the skills link to", () => {
    expect(headingAnchors(RUN_DOC).has("records")).toBe(true);
  });
});

describe("the local skills route through the shared step", () => {
  it.each([
    ["muggle-test/execute-local.md", EXECUTE_LOCAL_DOC],
    ["muggle-test-feature-local/SKILL.md", FEATURE_LOCAL_DOC],
    ["do/e2e-acceptance.md", E2E_ACCEPTANCE_DOC],
  ])("%s links the records step", (_name, doc) => {
    expect(doc).toContain(`](${RECORDS_STEP_LINK})`);
  });

  it("names the plan tool in the shared step alone", () => {
    const filesNamingPlanTool = listMarkdownFiles(SKILLS_DIR)
      .filter((filePath) => fs.readFileSync(filePath, "utf8").includes(FAN_OUT_PLAN_TOOL))
      .map((filePath) => path.relative(SKILLS_DIR, filePath).split(path.sep).join("/"));
    expect(filesNamingPlanTool).toEqual(["_shared/dev-loop/run.md"]);
  });

  it("muggle-test returns each record's run and skipped records without routing them to the debug path", () => {
    expect(executeLocalOutput).toContain("runSettingsId?, resolutionLabel?");
    expect(executeLocalOutput).toContain('status: "skipped", reason: "primary failed"');
    expect(executeLocalOutput).toMatch(/skips the debug path/);
  });
});

describe("muggle-do reports keep records apart", () => {
  it("files a skipped record as Inconclusive with reason primary failed", () => {
    expect(acceptanceRunStep).toMatch(/A record skipped because its primary failed is an Inconclusive entry with reason `primary failed`/);
  });

  it("carries runSettingsId and resolutionLabel on every result block", () => {
    for (const blockLabel of ["Passed", "Failed", "Inconclusive"]) {
      const blockBody = reportBlock(acceptanceOutput, blockLabel);
      expect(blockBody, `${blockLabel} block`).toMatch(/^ {2}- runSettingsId: /m);
      expect(blockBody, `${blockLabel} block`).toMatch(/^ {2}- resolutionLabel: /m);
    }
  });

  it("report assembly passes those fields through and renders a skipped record", () => {
    expect(REPORT_ASSEMBLY_DOC).toMatch(
      /`e2e-acceptance\.md` already produces this shape, each entry's `runSettingsId` and `resolutionLabel` included — pass it through unchanged/,
    );
    expect(REPORT_ASSEMBLY_DOC).toMatch(/an `inconclusive` entry with `reason: "primary failed"`/);
  });

  it("repair leaves a primary-failed entry to its primary", () => {
    expect(E2E_REPAIR_DOC).toMatch(/recorded as `primary failed` never executed either/);
    expect(E2E_REPAIR_DOC).toMatch(/It takes no disposition of its own/);
  });
});
