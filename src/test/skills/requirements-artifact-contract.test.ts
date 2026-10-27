/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins that Stage 2 writes the `requirements.md` session artifact. The
 * Definition of Done checks for it and Stages 3, 4 and 6 read it, but Stage 2
 * only said to "report" its findings, so the requirements lived in the
 * conversation and every reader of the file came up empty.
 *
 * Prose is the implementation here. These assertions do NOT catch an agent that
 * reads the rule and ignores it; the muggle-do adherence eval's Stage 2 entry
 * scenario does.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { sectionBody } from "./helpers/markdown-sections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "plugin", "skills");
const REQUIREMENTS_STAGE_DOC = path.join(SKILLS_DIR, "do", "requirements.md");
const BUILD_STAGE_DOC = path.join(SKILLS_DIR, "do", "build.md");
const MUGGLE_DO_SKILL_DOC = path.join(SKILLS_DIR, "muggle-do", "SKILL.md");
const SESSION_ARTIFACT_PATH = "~/.muggle-ai/muggle-do/sessions/<slug>/requirements.md";

const read = (docPath: string): string => fs.readFileSync(docPath, "utf8");

const stageOutput = sectionBody(read(REQUIREMENTS_STAGE_DOC), /^## Output.*$/m);
const definitionOfDone = sectionBody(read(MUGGLE_DO_SKILL_DOC), /^### Definition of Done.*$/m);
const buildInputs = sectionBody(read(BUILD_STAGE_DOC), /^## Inputs.*$/m);

describe("parser sanity: refuse to pass vacuously", () => {
  it("finds every section under test", () => {
    for (const [name, body] of Object.entries({
      stageOutput: stageOutput,
      definitionOfDone: definitionOfDone,
      buildInputs: buildInputs,
    })) {
      expect(body.length, `section not found or empty: ${name}`).toBeGreaterThan(50);
    }
  });
});

describe("Stage 2 writes the requirements artifact", () => {
  it("tells the agent to write requirements.md into the session directory", () => {
    expect(stageOutput).toMatch(/\bWrite\b/);
    expect(stageOutput).toContain(SESSION_ARTIFACT_PATH);
  });

  it("gives the file every field its readers consume", () => {
    for (const field of ["**Goal:**", "**Acceptance Criteria:**", "**Affected Repos:**"]) {
      expect(stageOutput).toContain(field);
    }
  });

  it("requires the stage marker in the iteration log", () => {
    expect(stageOutput).toMatch(/iterations\/<NNN>\.md/);
  });
});

describe("the artifact Stage 2 writes is the one its consumers check", () => {
  it("is named by the Definition of Done", () => {
    expect(definitionOfDone).toMatch(/`requirements\.md` written/);
  });

  it("is what Stage 3 builds from", () => {
    expect(buildInputs).toMatch(/`requirements\.md` from stage 2/);
  });
});
