/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins that muggle-do never starts Stage 3 Build before the design is
 * finalized: Stage 2.5 is the only writer of the `Design: finalized` line,
 * Stage 3 refuses to edit without it, and the user approves by merging a
 * design PR — never a prompt — which neither autonomy nor
 * `frontloadQuestions=always` defaults away.
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
const CLEANUP_STAGE_DOC = path.join(SKILLS_DIR, "do", "cleanup.md");
const INPUT_ROUTING_DOC = path.join(SKILLS_DIR, "do", "input-routing.md");
const MUGGLE_DO_SKILL_DOC = path.join(SKILLS_DIR, "muggle-do", "SKILL.md");
const FRONTLOAD_GATE_DOC = path.join(SKILLS_DIR, "muggle-preferences", "preference-gates", "frontloadQuestions.md");
const DESIGN_FINALIZED_LINE = "Design: finalized";

const read = (docPath: string): string => fs.readFileSync(docPath, "utf8");

const designStage = read(DESIGN_STAGE_DOC);
const designPr = sectionBody(designStage, /^## Design PR.*$/m);
const cleanupStage = read(CLEANUP_STAGE_DOC);
const buildJob = sectionBody(read(BUILD_STAGE_DOC), /^## Your job.*$/m);
const preFlightQuestionnaire = sectionBody(read(PRE_FLIGHT_DOC), /^## The consolidated questionnaire.*$/m);
const muggleDoSkill = read(MUGGLE_DO_SKILL_DOC);
const definitionOfDone = sectionBody(muggleDoSkill, /^### Definition of Done.*$/m);

describe("parser sanity: refuse to pass vacuously", () => {
  it("finds every section under test", () => {
    for (const [name, body] of Object.entries({
      designPr: designPr,
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

describe("Stage 2.5 holds the build until its design PR merges", () => {
  it("opens a ready design PR instead of asking for approval", () => {
    expect(designPr).toMatch(/This stage calls no `AskUserQuestion`/);
    expect(designPr).toMatch(/never a draft/);
    expect(designPr).toMatch(/Title `\[DESIGN\] <goal>`/);
    expect(designPr).toMatch(/Merging this PR approves the design and starts the build/);
  });

  it("settles the design PR's walkthrough without a browser run", () => {
    expect(designPr).toMatch(/MUGGLE_E2E_SKIP: NOT_APPLICABLE: design document only/);
  });

  it("watches the design PR from its own slot, never holding it", () => {
    expect(designPr).toMatch(/<slug>-design/);
    expect(designPr).toMatch(/`Design PR for: <slug>`/);
    expect(designPr).toMatch(/\*\*without\*\* `forward_stages_in_flight`/);
    expect(designPr).toMatch(/`Design: pending — design PR <url>`/);
  });

  it("ends the forward turn awaiting the merge", () => {
    expect(designStage).toMatch(/MUGGLE_STAGE_SKIP: design PR awaiting merge/);
  });

  it("leaves the merge to the user under frontloadQuestions and unattended runs", () => {
    expect(designStage).toMatch(/`frontloadQuestions=always` never defaults it/);
    expect(designStage).toMatch(/unattended still stops here/);
    expect(read(FRONTLOAD_GATE_DOC)).toMatch(/approving a design before it is built/);
    expect(read(FRONTLOAD_GATE_DOC)).toMatch(/merging its design PR — is never asked/);
  });

  it("never reopens a design state.md already records", () => {
    expect(designStage).toMatch(/\*\*Already decided\.\*\*/);
    expect(designStage).toMatch(/`Design: finalized` → the stage is closed: reopen nothing/);
    expect(designStage).toMatch(/`Design: pending` → .*Open no second PR/);
    expect(designStage).toMatch(/`Design: rejected` → .*Build nothing/);
  });

  it("exempts only a user-supplied spec, a trivial change, or a pre-flight approval", () => {
    expect(designStage).toMatch(/\*\*Spec supplied\.\*\*/);
    expect(designStage).toMatch(/\*\*Trivial change\.\*\*.*When unsure, it is not trivial\./s);
    expect(designStage).toMatch(/\*\*Approved in pre-flight\.\*\*/);
  });
});

describe("merging the design PR approves the design and resumes the build", () => {
  it("records the finalized line in the build slot and dispatches resume on merge", () => {
    expect(cleanupStage).toMatch(/`Design: finalized — design PR <url> merged/);
    expect(cleanupStage).toMatch(/`\/muggle-do resume slug=<build-slug>`/);
  });

  it("records a rejection when the design PR closes unmerged", () => {
    expect(cleanupStage).toMatch(/`closed` → `Design: rejected — design PR <url> closed unmerged/);
  });

  it("routes the resume directive to the forward pipeline", () => {
    expect(read(INPUT_ROUTING_DOC)).toMatch(/\*\*Resume\*\* — a `resume` token and `slug=<slug>`.*forward pipeline/);
  });

  it("lets a design slot's review cycles edit only its design doc", () => {
    expect(buildJob).toMatch(/`Design PR for: <slug>`.*edit only the file its `Design doc:` line names/);
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
