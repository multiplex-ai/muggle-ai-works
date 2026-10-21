/**
 * Every skill instruction that tells the agent to declare an E2E skip must cite
 * a code the guardrail accepts.
 *
 * The Stop-hook gate rejects a `MUGGLE_E2E_SKIP` declaration whose first token
 * is not an `E2eSkipCode`, so a skill that teaches `MUGGLE_E2E_SKIP: <reason>`
 * steers the agent into a rejection: the gate stays blocked and the PR's
 * walkthrough comment never settles. This lint holds every instruction to the
 * `<CODE>` placeholder or a literal code from the enum.
 *
 * Prose is the implementation here. These assertions do NOT catch an agent that
 * reads the instruction correctly and ignores it.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { E2E_SKIP_CODES } from "../../e2e-skip/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, "../../..", "plugin", "skills");

const CODE_PLACEHOLDER = "<CODE>";
const SKIP_DECLARATION_TOKEN = /MUGGLE_E2E_SKIP:\s*([^\s"`:]+)/g;

function listMarkdownFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(entryPath);
    return entry.name.endsWith(".md") ? [entryPath] : [];
  });
}

function findUncodedDeclarations(): string[] {
  const acceptedTokens = new Set<string>([CODE_PLACEHOLDER, ...E2E_SKIP_CODES]);
  return listMarkdownFiles(SKILLS_DIR).flatMap((skillFile) => {
    const skillText = fs.readFileSync(skillFile, "utf8");
    return [...skillText.matchAll(SKIP_DECLARATION_TOKEN)]
      .filter((match) => !acceptedTokens.has(match[1]))
      .map((match) => `${path.relative(SKILLS_DIR, skillFile)}: MUGGLE_E2E_SKIP: ${match[1]}`);
  });
}

describe("E2E skip declarations in skill instructions", () => {
  it("finds the declarations it lints", () => {
    const declarationCount = listMarkdownFiles(SKILLS_DIR).reduce(
      (count, skillFile) => count + [...fs.readFileSync(skillFile, "utf8").matchAll(SKIP_DECLARATION_TOKEN)].length,
      0,
    );
    expect(declarationCount).toBeGreaterThan(0);
  });

  it("cite <CODE> or an accepted skip code, never a free-text reason", () => {
    expect(findUncodedDeclarations()).toEqual([]);
  });
});
