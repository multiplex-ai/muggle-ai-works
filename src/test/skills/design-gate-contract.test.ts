/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins that muggle-do never starts Stage 3 Build before the design is
 * finalized: Stage 2.5 is the only writer of the `Design: finalized` line,
 * Stage 3 refuses to edit without it, and the user's approval is a stop that
 * neither autonomy nor `frontloadQuestions=always` defaults away.
 *
 * Prose is the implementation here. These assertions do NOT catch an agent that
 * reads the rule and ignores it; the muggle-do adherence eval does.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDeclaredStages } from "../../guardrails/mandatoryStages.js";
import { sectionBody } from "./helpers/markdown-sections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, "../../..", "plugin", "skills");
const DESIGN_STAGE_DOC = path.join(SKILLS_DIR, "do", "design.md");
const BUILD_STAGE_DOC = path.join(SKILLS_DIR, "do", "build.md");
const PRE_FLIGHT_DOC = path.join(SKILLS_DIR, "do", "pre-flight.md");
const MUGGLE_DO_SKILL_DOC = path.join(SKILLS_DIR, "muggle-do", "SKILL.md");
const FRONTLOAD_GATE_DOC = path.join(SKILLS_DIR, "muggle-preferences", "preference-gates", "frontloadQuestions.md");
const DESIGN_FINALIZED_LINE = "Design: finalized";

const read = (docPath: string): string => fs.readFileSync(docPath, "utf8");

const designStage = read(DESIGN_STAGE_DOC);
const designApproval = sectionBody(designStage, /^## Approval.*$/m);
const buildJob = sectionBody(read(BUILD_STAGE_DOC), /^## Your job.*$/m);
const preFlightQuestionnaire = sectionBody(read(PRE_FLIGHT_DOC), /^## The consolidated questionnaire.*$/m);
const muggleDoSkill = read(MUGGLE_DO_SKILL_DOC);
const definitionOfDone = sectionBody(muggleDoSkill, /^### Definition of Done.*$/m);

describe("parser sanity: refuse to pass vacuously", () => {
  it("finds every section under test", () => {
    for (const [name, body] of Object.entries({
      designApproval: designApproval,
      buildJob: buildJob,
      preFlightQuestionnaire: preFlightQuestionnaire,
      definitionOfDone: definitionOfDone,
    })) {
      expect(body.length, `section not found or empty: ${name}`).toBeGreaterThan(50);
    }
  });
});

describe("Stage 2.5 sits between Requirements and Build", () => {
  it("is declared by the forward route right after requirements.md", () => {
    const forwardStages = parseDeclaredStages(read(PRE_FLIGHT_DOC));
    expect(forwardStages.indexOf("design.md")).toBe(forwardStages.indexOf("requirements.md") + 1);
    expect(forwardStages.indexOf("build.md")).toBe(forwardStages.indexOf("design.md") + 1);
  });

  it("has its row in the pipeline table", () => {
    expect(muggleDoSkill).toMatch(/^\| 2\.5 \| Design .*\(\.\.\/do\/design\.md\) \|$/m);
  });
});

describe("Stage 2.5 holds the build for the user's approval", () => {
  it("asks for approval and records the finalized line only on Approve", () => {
    expect(designApproval).toMatch(/AskUserQuestion/);
    expect(designApproval).toMatch(/`Approve` \/ `Request changes`/);
    expect(designApproval).toMatch(/On `Approve`.*`Design: finalized — approved/);
  });

  it("is never defaulted by frontloadQuestions or an unattended run", () => {
    expect(designApproval).toMatch(/`frontloadQuestions=always` never defaults it/);
    expect(designApproval).toMatch(/unattended still stops here/);
    expect(read(FRONTLOAD_GATE_DOC)).toMatch(/approving a design before it is built/);
  });

  it("never reopens a design state.md already records as finalized", () => {
    expect(designStage).toMatch(/\*\*Already finalized\.\*\*.*The stage is closed: reopen nothing/s);
  });

  it("exempts only a user-supplied spec or a trivial change", () => {
    expect(designStage).toMatch(/\*\*Spec supplied\.\*\*/);
    expect(designStage).toMatch(/\*\*Trivial change\.\*\*.*When unsure, it is not trivial\./s);
  });
});

describe("Stage 3 refuses to build without a finalized design", () => {
  it("checks the finalized line before any edit", () => {
    const gateStep = buildJob.indexOf(DESIGN_FINALIZED_LINE);
    expect(gateStep).toBeGreaterThanOrEqual(0);
    expect(gateStep).toBeLessThan(buildJob.indexOf("**Apply the change**"));
    expect(buildJob).toMatch(/Without it, edit nothing/);
  });

  it("is a Definition-of-Done line before the PR opens", () => {
    expect(definitionOfDone).toContain(`\`${DESIGN_FINALIZED_LINE}\` recorded in \`state.md\``);
  });
});

describe("pre-flight never asks what has a sensible default", () => {
  it("takes branch name and PR target silently", () => {
    expect(preFlightQuestionnaire).toMatch(/\*\*Branch name\*\* — never asked/);
    expect(preFlightQuestionnaire).toMatch(/\*\*PR target branch\*\* — never asked/);
  });

  it("never adds a confirm-the-defaults question", () => {
    expect(preFlightQuestionnaire).toMatch(/Never add a "confirm these defaults\?" question/);
  });
});
