/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins the deliverable categories muggle-do verifies. A criterion about a
 * video, image, audio file, dataset, or research brief used to be scoped
 * `unobservable` or skipped as NOT_APPLICABLE, so those changes reached review
 * with no acceptance evidence. Every category, web included, now has a flow file
 * declaring how its criteria are verified, and every stage that scopes, runs,
 * reports, or repairs acceptance reads that declaration rather than branching
 * on a category's name.
 *
 * Prose is the implementation here. These assertions do NOT catch an agent that
 * reads the contract and ignores it.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { sectionBody } from "./helpers/markdown-sections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, "../../../plugin");
const SKILLS_DIR = path.join(PLUGIN_DIR, "skills");
const DO_DIR = path.join(SKILLS_DIR, "do");

const read = (...segments: string[]): string => fs.readFileSync(path.join(...segments), "utf8");

const TEST_CASES_VERIFICATION = "test cases";
const DELIVERABLE_CHECK_VERIFICATION = "deliverable check";

const VERIFICATION_BY_CATEGORY: Record<string, string> = {
  web: TEST_CASES_VERIFICATION,
  video: DELIVERABLE_CHECK_VERIFICATION,
  image: DELIVERABLE_CHECK_VERIFICATION,
  audio: DELIVERABLE_CHECK_VERIFICATION,
  data: DELIVERABLE_CHECK_VERIFICATION,
  research: DELIVERABLE_CHECK_VERIFICATION,
};

const FLOW_HEADINGS_BY_VERIFICATION: Record<string, string[]> = {
  [TEST_CASES_VERIFICATION]: ["Artifact", "Test cases", "Review", "Inconclusive when"],
  [DELIVERABLE_CHECK_VERIFICATION]: ["Artifact", "Probes", "Review", "Inconclusive when"],
};
const CONTRACT_LINK = /deliverable-categories\.md/;

const CATEGORIES_DOC = read(SKILLS_DIR, "_shared", "deliverable-categories.md");
const IMPACT_ANALYSIS = read(DO_DIR, "impact-analysis.md");
const E2E_ACCEPTANCE = read(DO_DIR, "e2e-acceptance.md");
const E2E_REPAIR = read(DO_DIR, "e2e-repair.md");

const scopeSection = sectionBody(IMPACT_ANALYSIS, /^## Output state — e2eScope$/m);
const deliverableStep = sectionBody(E2E_ACCEPTANCE, /^### Step 5:.*$/m);
const evidenceSection = sectionBody(CATEGORIES_DOC, /^## Evidence on the PR$/m);

describe("parser sanity: refuse to pass vacuously", () => {
  it("finds every section under test", () => {
    for (const [name, body] of Object.entries({
      scopeSection: scopeSection,
      deliverableStep: deliverableStep,
      evidenceSection: evidenceSection,
    })) {
      expect(body.length, `section not found or empty: ${name}`).toBeGreaterThan(100);
    }
  });
});

describe("the categories file is the one list", () => {
  it("names every category", () => {
    expect(CATEGORIES_DOC).toMatch(/one of `web`, `video`, `image`, `audio`, `data`, `research`/);
  });

  it("special-cases no category: each is routed by its flow's declaration", () => {
    expect(CATEGORIES_DOC).toMatch(/No category is special-cased/);
    expect(CATEGORIES_DOC).toMatch(/never branch on a category's name/);
  });

  it("gives every category a flow file whose Verified by matches the index", () => {
    for (const [category, verification] of Object.entries(VERIFICATION_BY_CATEGORY)) {
      const flowFile = `deliverable-categories/${category}.md`;
      const flow = read(SKILLS_DIR, "_shared", flowFile);
      expect(CATEGORIES_DOC, `${category} row`).toContain(`| ${category} | ${verification} | [\`${flowFile}\`](${flowFile}) |`);
      expect(flow, `${category} declaration`).toContain(`**Verified by:** ${verification}.`);
      for (const heading of FLOW_HEADINGS_BY_VERIFICATION[verification]) {
        expect(flow, `${category} ${heading}`).toMatch(new RegExp(`^## ${heading}$`, "m"));
      }
      // A flow file linking back up to the index would make a cycle the skill-deps guard rejects.
      expect(flow, `${category} back-link`).not.toContain("](../deliverable-categories.md)");
    }
  });

  it("never lets a missing tool pass a check", () => {
    expect(CATEGORIES_DOC).toMatch(/`INCONCLUSIVE` with reason `probe tool missing: <tool>` — never a silent pass/);
  });

  it("keeps deliverable checks out of the walkthrough comment", () => {
    expect(evidenceSection).toMatch(/never go under the walkthrough heading or its slot marker/);
    expect(evidenceSection).toMatch(/not recorded on the Muggle dashboard/);
  });
});

describe("every acceptance stage reads the contract", () => {
  it("requirements tags each criterion with its category", () => {
    expect(read(DO_DIR, "requirements.md")).toMatch(CONTRACT_LINK);
  });

  it("impact analysis plans deliverable checks and maps criteria to them", () => {
    expect(scopeSection).toMatch(CONTRACT_LINK);
    expect(scopeSection).toMatch(/^\s+deliverableChecks:$/m);
    expect(scopeSection).toMatch(/verifiedBy/);
    expect(IMPACT_ANALYSIS).toMatch(/follows its category's flow file .*never the category's name/);
    expect(IMPACT_ANALYSIS).not.toMatch(/\[web\]/);
    expect(scopeSection).toMatch(/whenever `Validation` is not `skip`/);
  });

  it("E2E acceptance runs them and still declares the browser skip", () => {
    expect(deliverableStep).toMatch(CONTRACT_LINK);
    expect(deliverableStep).toMatch(/do not satisfy the session's browser E2E gate/);
    expect(E2E_ACCEPTANCE).toMatch(/^\*\*Deliverables:\*\*/m);
  });

  it("repair treats a failed check as a named defect", () => {
    expect(E2E_REPAIR).toMatch(/A `FAIL` entry is already a named defect.*disposition is `repair`/);
  });

  it("the PR body and the verdict taxonomy count them", () => {
    expect(read(DO_DIR, "open-prs", "forward.md")).toMatch(CONTRACT_LINK);
    expect(read(SKILLS_DIR, "_shared", "failure-mode-handling.md")).toMatch(CONTRACT_LINK);
    expect(read(PLUGIN_DIR, "agents", "acceptance-tester.md")).toMatch(CONTRACT_LINK);
  });
});
