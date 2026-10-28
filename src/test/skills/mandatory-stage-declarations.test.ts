/**
 * Pins the `mandatoryStages` declarations the skills ship.
 *
 * The stage gate drops a declared path it cannot resolve, so a renamed or moved
 * stage file silently stops being enforced. Every declaration must resolve, and
 * muggle-do must keep one set per route: the router in SKILL.md, the rest on
 * each route's entry file.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDeclaredStages, resolveDeclaredStagePaths } from "../../guardrails/mandatoryStages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, "../../..", "plugin", "skills");

const MUGGLE_DO_DECLARING_FILES = [
  "muggle-do/SKILL.md",
  "do/pre-flight.md",
  "do/address-reviews.md",
  "do/fix-ci.md",
  "do/resolve-conflicts.md",
];

function skillTreeMarkdown(directory: string = SKILLS_DIR): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return skillTreeMarkdown(entryPath);
    return entry.name.endsWith(".md") ? [entryPath] : [];
  });
}

const declaredStages = (filePath: string): string[] => parseDeclaredStages(fs.readFileSync(filePath, "utf8"));
const skillsRelative = (filePath: string): string => path.relative(SKILLS_DIR, filePath).replaceAll("\\", "/");

const declaringFiles = skillTreeMarkdown().filter((filePath) => declaredStages(filePath).length > 0);

describe("mandatoryStages declarations", () => {
  it("cover muggle-do's router and its route entry files", () => {
    expect(declaringFiles.map(skillsRelative)).toEqual(expect.arrayContaining(MUGGLE_DO_DECLARING_FILES));
  });

  it("keep muggle-do's SKILL.md to the router every route reads", () => {
    expect(declaredStages(path.join(SKILLS_DIR, "muggle-do", "SKILL.md"))).toEqual(["../do/input-routing.md"]);
  });

  it.each(declaringFiles.map((filePath) => [skillsRelative(filePath), filePath]))(
    "%s declares only stages that resolve inside the skills tree",
    (_label, filePath) => {
      expect(resolveDeclaredStagePaths(filePath, SKILLS_DIR)).toHaveLength(declaredStages(filePath).length);
    },
  );
});
