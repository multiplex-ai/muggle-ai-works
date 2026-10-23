/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins where muggle-do decides which E2E cases run. Impact analysis (Stage 4)
 * scopes the impacted existing use cases and test cases and plans the new ones;
 * E2E acceptance (Stage 6) creates the planned cases and runs exactly that scope.
 * When Stage 6 re-listed the project and filtered by judgment, an acceptance
 * criterion with no existing test case went untested and nothing noticed.
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
const SKILLS_DIR = path.resolve(__dirname, "../../../plugin/skills");
const DO_DIR = path.join(SKILLS_DIR, "do");

const read = (...segments: string[]): string => fs.readFileSync(path.join(...segments), "utf8");

const IMPACT_ANALYSIS = read(DO_DIR, "impact-analysis.md");
const E2E_ACCEPTANCE = read(DO_DIR, "e2e-acceptance.md");
const WAVE_E2E = read(DO_DIR, "wave-e2e.md");
const ADDRESS_REVIEWS = read(DO_DIR, "address-reviews.md");
const MUGGLE_DO = read(SKILLS_DIR, "muggle-do", "SKILL.md");

const SCOPE_LISTS = [
  "impactedUseCases",
  "impactedTestCases",
  "supersededTestCases",
  "newUseCases",
  "newTestCases",
  "criteria",
];

const scopeSection = sectionBody(IMPACT_ANALYSIS, /^## Output state — e2eScope$/m);
const loadScopeStep = sectionBody(E2E_ACCEPTANCE, /^### Step 2:.*$/m);
const createCasesStep = sectionBody(E2E_ACCEPTANCE, /^### Step 3:.*$/m);
const chainStep = sectionBody(E2E_ACCEPTANCE, /^### Step 3\.5:.*$/m);
const addressReviewsE2e = sectionBody(ADDRESS_REVIEWS, /^#### 4e\..*$/m);
const definitionOfDone = sectionBody(MUGGLE_DO, /^### Definition of Done.*$/m);

describe("parser sanity: refuse to pass vacuously", () => {
  it("finds every section under test", () => {
    for (const [name, body] of Object.entries({
      scopeSection: scopeSection,
      loadScopeStep: loadScopeStep,
      createCasesStep: createCasesStep,
      chainStep: chainStep,
      addressReviewsE2e: addressReviewsE2e,
      definitionOfDone: definitionOfDone,
    })) {
      expect(body.length, `section not found or empty: ${name}`).toBeGreaterThan(100);
    }
  });
});

describe("impact analysis scopes the E2E cases", () => {
  it("runs the scoping as a step of its job", () => {
    expect(IMPACT_ANALYSIS).toMatch(/^9\. \*\*Scope the E2E cases\*\*.*`e2eScope`/m);
  });

  it("emits every list of the scope shape", () => {
    for (const list of SCOPE_LISTS) expect(scopeSection).toMatch(new RegExp(String.raw`^\s+${list}:$`, "m"));
    expect(scopeSection).toMatch(/empty list is written empty, never omitted/);
  });

  it("scopes only cycles that run E2E, and says why otherwise", () => {
    expect(scopeSection).toMatch(/Scope only when this cycle runs E2E/);
    expect(scopeSection).toMatch(/`Validation` is `local-e2e`/);
    expect(scopeSection).toMatch(/`cycleSize` is `full`/);
    expect(scopeSection).toContain("e2eScope: not-scoped — <the condition that failed>");
  });

  it("maps every acceptance criterion to a test case or to unobservable", () => {
    expect(scopeSection).toMatch(/coveredBy/);
    expect(scopeSection).toMatch(/unobservable/);
    expect(scopeSection).toMatch(/criterion with neither is a scoping failure/);
  });

  it("supersedes a test case the change alters instead of replaying it", () => {
    expect(scopeSection).toMatch(/fails by design/);
    expect(scopeSection).toMatch(/Stage 6 cannot edit a remote test case/);
    expect(scopeSection).toMatch(/replacedBy/);
  });

  it("plans new cases under the atomic test case rule and creates nothing", () => {
    expect(scopeSection).toMatch(/\]\(\.\.\/_shared\/test-case-design\.md\)/);
    expect(scopeSection).toMatch(/plans new cases and creates nothing/);
  });

  it("records the scope where later stages read it", () => {
    expect(scopeSection).toMatch(/marker in `iterations\/<NNN>\.md`/);
  });
});

describe("E2E acceptance runs the scope it was handed", () => {
  it("orders load scope → create cases → prerequisites → run", () => {
    const offsets = [/^### Step 2:/m, /^### Step 3:/m, /^### Step 3\.5:/m, /^### Step 4:/m].map((heading) =>
      E2E_ACCEPTANCE.search(heading),
    );
    for (const offset of offsets) expect(offset).toBeGreaterThan(-1);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it("reads the scope from impact analysis rather than re-selecting", () => {
    expect(IMPACT_ANALYSIS).toMatch(/^## Output state — e2eScope$/m);
    expect(loadScopeStep).toMatch(/\]\(impact-analysis\.md#output-state--e2escope\)/);
    expect(loadScopeStep).toMatch(/Do not re-list the project or re-select by judgment/);
    expect(loadScopeStep).toMatch(/Never fall back to every case in the project/);
    expect(E2E_ACCEPTANCE).not.toMatch(/fetch all test cases/);
  });

  it("never drops a scoped case and never runs a superseded one", () => {
    expect(loadScopeStep).toMatch(/A scoped case is never dropped/);
    expect(loadScopeStep).toMatch(/\*\*Superseded test cases\*\* are not run/);
  });

  it("creates the planned use cases, then generates and creates the test cases", () => {
    const tools = [
      "muggle-remote-use-case-create-from-prompts",
      "muggle-remote-test-case-generate-from-prompt",
      "muggle-remote-test-case-create",
    ].map((tool) => createCasesStep.indexOf(`\`${tool}\``));
    for (const offset of tools) expect(offset).toBeGreaterThan(-1);
    expect([...tools].sort((a, b) => a - b)).toEqual(tools);
    expect(createCasesStep).toMatch(/Accept the generator's decomposition as-is/);
  });

  it("resolves prerequisites for every case in scope, new ones included", () => {
    expect(chainStep).toMatch(/every test case in scope after Step 3/);
  });

  it("reports the scope it ran", () => {
    expect(E2E_ACCEPTANCE).toMatch(/\*\*Scope:\*\* \(from `e2eScope`, after Step 3\)/);
    expect(E2E_ACCEPTANCE).not.toMatch(/every relevant test case/);
  });
});

describe("callers hand the scope through", () => {
  it("a wave runs the union of its members' scopes", () => {
    expect(WAVE_E2E).toMatch(/union of each member's `e2eScope`/);
  });

  it("an address-reviews full cycle runs the scope from its sizing step", () => {
    expect(addressReviewsE2e).toMatch(/`e2eScope` impact analysis emitted in 4c/);
  });

  it("the Definition of Done gates on the scope and a verdict for each scoped case", () => {
    expect(definitionOfDone).toMatch(/Stage 4's `e2eScope` recorded/);
    expect(definitionOfDone).toMatch(/`not-scoped` with the condition that failed/);
    expect(definitionOfDone).toMatch(/`runId` for every case in that scope/);
  });
});
