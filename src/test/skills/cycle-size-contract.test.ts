/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins the cycle-size rule for watcher-dispatched cycles. A cycle that changed
 * no app logic skips E2E under the verified `NO_APP_LOGIC_CHANGE` code; anything
 * else runs the full tail. The rule lives once in `do/cycle-size.md`, and each
 * mode points at it — a mode that restates its own "only if app logic changed"
 * judgment is the drift this file exists to catch.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_SKIP_CODES } from "../../e2e-skip/constants";
import { E2eSkipCode } from "../../e2e-skip/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, "../../../plugin/skills");
const DO_DIR = path.join(SKILLS_DIR, "do");

const read = (...segments: string[]): string => fs.readFileSync(path.join(...segments), "utf8");

const CYCLE_SIZE = read(DO_DIR, "cycle-size.md");
const ADDRESS_REVIEWS = read(DO_DIR, "address-reviews.md");
const UPDATE = read(DO_DIR, "open-prs", "update.md");
const FIX_CI = read(DO_DIR, "fix-ci.md");
const RESOLVE_CONFLICTS = read(DO_DIR, "resolve-conflicts.md");
const E2E_ACCEPTANCE = read(DO_DIR, "e2e-acceptance.md");
const IMPACT_ANALYSIS = read(DO_DIR, "impact-analysis.md");
const MUGGLE_DO = read(SKILLS_DIR, "muggle-do", "SKILL.md");

/** Body of the `#### <label>` sub-step, up to the next `####` or `###` heading. */
function subStep(doc: string, label: string): string {
  const start = doc.indexOf(`#### ${label}`);
  if (start === -1) return "";
  const rest = doc.slice(start);
  const bodyStart = rest.indexOf("\n") + 1;
  const end = rest.slice(bodyStart).search(/^#{3,4} /m);
  return end === -1 ? rest : rest.slice(0, bodyStart + end);
}

describe("the shared rule", () => {
  it("defines both tails and sizes from the diff, never the review", () => {
    expect(CYCLE_SIZE).toMatch(/^## Full tail$/m);
    expect(CYCLE_SIZE).toMatch(/^## Minor tail$/m);
    expect(CYCLE_SIZE).toMatch(/never how a review was worded/i);
  });

  it("makes a comment-only source edit full, because the rule reads paths", () => {
    expect(CYCLE_SIZE).toMatch(/comment-only .* source file included/i);
    expect(CYCLE_SIZE).toMatch(/path rule is what the guardrail can verify/i);
  });

  it("declares the skip with the cycle's starting commit, after the push", () => {
    expect(CYCLE_SIZE).toMatch(/MUGGLE_E2E_SKIP: NO_APP_LOGIC_CHANGE: <pre_cycle_sha>/);
    expect(CYCLE_SIZE).toMatch(/Declare after the push/);
  });

  it("names the walkthrough the skip leaves behind, and the red it cannot clear", () => {
    expect(CYCLE_SIZE).toMatch(/E2E skipped — no app-logic change in `<short-sha>`/);
    expect(CYCLE_SIZE).toMatch(/last full run's walkthrough collapsed/i);
    expect(CYCLE_SIZE).toMatch(/check stays red/i);
  });

  it("turns a rejected declaration into a full cycle", () => {
    expect(CYCLE_SIZE).toMatch(/\*\*Rejected\*\*.*full after all/s);
  });
});

describe("address-reviews picks its tail from impact analysis of the diff", () => {
  const steps = ["4b. Apply", "4c. Size the cycle", "4d. Create or update unit", "4e. Run ONE E2E", "4f. Create or update the PR", "4g. Post per-comment"];

  it("orders build → size → unit → E2E → update → replies", () => {
    const offsets = steps.map((label) => ADDRESS_REVIEWS.indexOf(`#### ${label}`));
    for (const offset of offsets) expect(offset).toBeGreaterThan(-1);
    expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
  });

  it("sizes with impact analysis and the shared rule, not with classification", () => {
    const size = subStep(ADDRESS_REVIEWS, "4c. Size the cycle");
    expect(size).toMatch(/impact-analysis\.md/);
    expect(size).toMatch(/cycle-size\.md/);
    expect(size).toMatch(/pre_cycle_sha/);
    expect(size).toMatch(/classification never sizes the cycle/i);
  });

  it("runs E2E only on the full branch", () => {
    const size = subStep(ADDRESS_REVIEWS, "4c. Size the cycle");
    expect(size).toMatch(/\*\*minor\*\* runs 4d → 4f → 4g/);
    expect(size).toMatch(/\*\*full\*\* runs 4d → 4e → 4f → 4g/);
    expect(subStep(ADDRESS_REVIEWS, "4e. Run ONE E2E")).toMatch(/minor cycle skips this step/i);
  });

  it("records the starting commit before the first edit", () => {
    expect(subStep(ADDRESS_REVIEWS, "4b. Apply")).toMatch(/Record `pre_cycle_sha`.*before the first edit/);
  });

  it("hands the size to the update stage, which declares the skip only after its push", () => {
    expect(subStep(ADDRESS_REVIEWS, "4f. Create or update the PR")).toMatch(/cycle size/);
    const push = UPDATE.search(/^1\.\s+\*\*Push:/m);
    const walkthrough = UPDATE.search(/^5\.\s+\*\*Visual walkthrough comment/m);
    expect(push).toBeGreaterThan(-1);
    expect(walkthrough).toBeGreaterThan(push);
    const minorBranch = UPDATE.slice(walkthrough).match(/\*\*No report, minor cycle\*\*[^\n]*/)?.[0] ?? "";
    expect(minorBranch).toMatch(/NO_APP_LOGIC_CHANGE/);
    expect(minorBranch).toMatch(/cycle-size\.md/);
  });

  it("impact analysis emits the cycle size from the cycle's own diff", () => {
    expect(IMPACT_ANALYSIS).toMatch(/cycleSize: <minor \| full>/);
    expect(IMPACT_ANALYSIS).toMatch(/git diff --name-only --no-renames <pre_cycle_sha>/);
  });
});

describe("fix-ci and rebase share the one rule", () => {
  it.each([
    ["fix-ci", FIX_CI],
    ["resolve-conflicts", RESOLVE_CONFLICTS],
  ])("%s points at cycle-size.md and the verified code", (_mode, doc) => {
    expect(doc).toMatch(/\]\(cycle-size\.md\)/);
    expect(doc).toMatch(/NO_APP_LOGIC_CHANGE/);
  });

  it.each([
    ["fix-ci", FIX_CI],
    ["resolve-conflicts", RESOLVE_CONFLICTS],
  ])("%s no longer restates its own app-logic judgment", (_mode, doc) => {
    expect(doc).not.toMatch(/only if the fix touched app logic/i);
    expect(doc).not.toMatch(/when app logic changed/i);
  });

  it("fix-ci and rebase size against the head they started from", () => {
    expect(FIX_CI).toMatch(/pre_cycle_sha = red_sha/);
    expect(RESOLVE_CONFLICTS).toMatch(/pre_cycle_sha = rebase_sha/);
  });
});

describe("the skip-code list lives once", () => {
  it("e2e-acceptance.md names every verified code", () => {
    for (const code of E2E_SKIP_CODES) expect(E2E_ACCEPTANCE).toContain(`\`${code}\``);
  });

  it("e2e-acceptance.md states how NO_APP_LOGIC_CHANGE is verified", () => {
    expect(E2E_ACCEPTANCE).toMatch(/NO_APP_LOGIC_CHANGE` belongs to a watcher cycle's minor tail/);
    expect(E2E_ACCEPTANCE).toMatch(/comment-only edit in a source file included — fails/);
  });

  it("muggle-do's Definition of Done references the list instead of restating it", () => {
    const definitionOfDone = MUGGLE_DO.slice(MUGGLE_DO.indexOf("### Definition of Done"));
    expect(definitionOfDone).toMatch(/verified skip code from \[`\.\.\/do\/e2e-acceptance\.md`\]/);
    expect(definitionOfDone).not.toContain(E2eSkipCode.UserWaived);
  });

  it("muggle-do no longer claims address-reviews shares the E2E stage unconditionally", () => {
    expect(MUGGLE_DO).not.toMatch(/Shares stages 3–6/);
    expect(MUGGLE_DO).toMatch(/cycle-size\.md/);
  });
});
