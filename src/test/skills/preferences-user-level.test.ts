/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins preferences as user-level after the per-project layer was removed. Two
 * failure modes this catches, both silent:
 *
 * 1. A skill doc that still offers a per-project scope. The tool now rejects a
 *    `scope` argument, so a doc promising one sends the agent into a call that
 *    always fails.
 * 2. A doc that still describes three-layer resolution. Agents act on the prose,
 *    so a stale layer sends them looking for a file nothing reads.
 *
 * Prose is the implementation here. These assertions do NOT catch an agent that
 * reads the contract correctly and ignores it.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "plugin", "skills");
const PREFERENCES_DIR = path.join(SKILLS_DIR, "muggle-preferences");

const read = (docPath: string): string => fs.readFileSync(docPath, "utf8");

function collectSkillDocs(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        found.push(full);
      }
    }
  };
  walk(SKILLS_DIR);
  return found;
}

const skillDocs = collectSkillDocs();

describe("parser sanity: refuse to pass vacuously", () => {
  it("collected a plausible number of skill docs", () => {
    expect(skillDocs.length).toBeGreaterThan(20);
  });

  it("the preferences skill's own docs are among them", () => {
    expect(skillDocs.some((p) => p.startsWith(PREFERENCES_DIR))).toBe(true);
  });
});

describe("preferences are user-level", () => {
  it("no skill doc offers a per-project preferences scope", () => {
    for (const docPath of skillDocs) {
      expect(read(docPath), `per-project scope offered in ${path.basename(docPath)}`).not.toMatch(
        /This project only/i,
      );
    }
  });

  it("no skill doc tells the agent to pass a scope argument", () => {
    for (const docPath of skillDocs) {
      // `muggle-local-preferences-set` rejects unrecognized keys, so a doc that
      // still promises `scope` describes a call that cannot succeed.
      expect(read(docPath), `scope argument in ${path.basename(docPath)}`).not.toMatch(
        /scope\s*[:=]\s*["']?(project|global)["']?/i,
      );
    }
  });

  it("the skill states that every write is user-level", () => {
    const doc = read(path.join(PREFERENCES_DIR, "SKILL.md"));
    expect(doc).toMatch(/user-level/i);
    expect(doc).toMatch(/every repo|all repos/i);
  });

  it("the gate contract describes resolution without a project layer", () => {
    const doc = read(path.join(PREFERENCES_DIR, "preference-gates", "README.md"));
    expect(doc).toMatch(/~\/\.muggle-ai\/preferences\.json/);
    expect(doc).toMatch(/user-level/i);
  });

  it("the router describes two-layer resolution", () => {
    const doc = read(path.join(SKILLS_DIR, "muggle", "SKILL.md"));
    expect(doc).toMatch(/defaults\s*→\s*`?~\/\.muggle-ai\/preferences\.json/);
  });
});
