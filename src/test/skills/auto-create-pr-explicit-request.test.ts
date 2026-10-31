/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins the one exception to the `autoCreatePR` gate: a user who asks for the PR
 * in their own words gets it for that run, even under `never`. The rule lives
 * once, in the gate file, so every skill that fires the gate inherits it; a
 * second copy elsewhere is the drift this file exists to catch. The default
 * must stay intact when the request says nothing about a PR.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "plugin", "skills");
const AUTO_CREATE_PR_GATE_DOC = path.join(SKILLS_DIR, "muggle-preferences", "preference-gates", "autoCreatePR.md");
const FORWARD_OPEN_PRS_DOC = path.join(SKILLS_DIR, "do", "open-prs", "forward.md");

const read = (docPath: string): string => fs.readFileSync(docPath, "utf8");

/** Every markdown file under `dir`, recursively. */
function listSkillMarkdown(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) listSkillMarkdown(entryPath, found);
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push(entryPath);
  }
  return found;
}

const explicitRequestRule =
  read(AUTO_CREATE_PR_GATE_DOC)
    .split(/\n\s*\n/)
    .find((paragraph) => paragraph.startsWith("**Explicit request**")) ?? "";

describe("the gate file states the explicit-request override", () => {
  it("has the rule", () => {
    expect(explicitRequestRule.length).toBeGreaterThan(100);
  });

  it("counts only the user's own words, not the skill that was invoked", () => {
    expect(explicitRequestRule).toMatch(/user's own words/);
    expect(explicitRequestRule).toMatch(/Invoking a skill whose job ends in a PR is not such a request/);
  });

  it("takes the always action for this run only, whatever the saved value", () => {
    expect(explicitRequestRule).toMatch(/take the `always` action for this run whatever the saved value/);
    expect(explicitRequestRule).toMatch(/the saved value never changes/);
  });

  it("leaves the default in charge when the request is silent on the PR", () => {
    expect(explicitRequestRule).toMatch(/A request silent on the PR leaves the saved value in charge/);
  });

  it("names the override in the footer instead of claiming the saved value was honored", () => {
    expect(explicitRequestRule).toMatch(/overriding `autoCreatePR=<value>` for this run/);
  });

  it("lifts the gate only, never a halt or the Definition of Done", () => {
    expect(explicitRequestRule).toMatch(/lifts this gate only, never a halt or an unmet Definition of Done line/);
  });
});

describe("the rule is stated once", () => {
  it("Stage 5.5 points at the gate's rule rather than restating it", () => {
    const gateStep = read(FORWARD_OPEN_PRS_DOC).match(/^0\.\s+\*\*`autoCreatePR` gate\*\*.*$/m);
    expect(gateStep).not.toBeNull();
    expect(gateStep![0]).toMatch(/preference-gates\/autoCreatePR\.md\)/);
    expect(gateStep![0]).toMatch(/explicit-request rule included/);
    expect(gateStep![0]).not.toMatch(/`always` action/);
  });

  it("no other skill file restates the override", () => {
    const restatements = listSkillMarkdown(SKILLS_DIR)
      .filter((docPath) => docPath !== AUTO_CREATE_PR_GATE_DOC)
      .filter((docPath) => /overrid\w*[^.\n]*autoCreatePR|autoCreatePR[^.\n]*overrid/i.test(read(docPath)));
    expect(restatements.map((docPath) => path.relative(REPO_ROOT, docPath))).toEqual([]);
  });
});
