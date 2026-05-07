/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Verifies wiring between SKILL.md preference tables and the
 * preference-gates/<key>.md contract files. Catches drift; does NOT
 * catch "the LLM forgot to fire the gate" — that is Layer 2.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "plugin", "skills");
const GATES_DIR = path.join(
  SKILLS_DIR,
  "muggle-preferences",
  "preference-gates",
);

const CANONICAL_VALUES = new Set([
  "always",
  "never",
  "ask",
  "local",
  "remote",
]);

interface SkillGateRefs {
  skill: string;
  gates: string[];
}

interface GateContract {
  key: string;
  ungated: boolean;
  picker1Values: Set<string>;
  silentActionValues: Set<string>;
}

function listSkills(): string[] {
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => fs.existsSync(path.join(SKILLS_DIR, n, "SKILL.md")));
}

/**
 * Parse the `## Preferences` table out of a SKILL.md and return the
 * preference keys it claims to fire. Returns [] if no table is present
 * (e.g., the router skill has a Preferences section but no table).
 */
function parseSkillGates(skillName: string): SkillGateRefs {
  const md = fs.readFileSync(
    path.join(SKILLS_DIR, skillName, "SKILL.md"),
    "utf8",
  );
  const lines = md.split("\n");
  const prefHeader = lines.findIndex((l) => /^##\s+Preferences\b/i.test(l));
  if (prefHeader === -1) return { skill: skillName, gates: [] };

  // Find the first markdown table after the heading whose first column is "Preference".
  let i = prefHeader + 1;
  while (i < lines.length && !/^##\s/.test(lines[i])) {
    if (/^\|\s*Preference\s*\|/i.test(lines[i])) {
      i += 2; // skip header + separator
      const gates: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const firstCell = lines[i].split("|")[1] ?? "";
        const m = firstCell.match(/`([^`]+)`/);
        if (m) gates.push(m[1]);
        i++;
      }
      return { skill: skillName, gates };
    }
    i++;
  }
  return { skill: skillName, gates: [] };
}

/**
 * Parse a preference-gate contract file. Picker 1 values come from
 * `→ \`<value>\`` mappings on bullet lines. Silent-action values come
 * from `- \`<value>\` →` lines under the **Silent action** heading.
 */
function parseGateFile(key: string): GateContract {
  const md = fs.readFileSync(path.join(GATES_DIR, `${key}.md`), "utf8");
  if (/Not gated\./.test(md)) {
    return {
      key,
      ungated: true,
      picker1Values: new Set(),
      silentActionValues: new Set(),
    };
  }

  const picker1Values = new Set<string>();
  for (const line of md.split("\n")) {
    if (!line.trimStart().startsWith("-")) continue;
    // Match the trailing `→ \`<value>\`` segment of a Picker 1 bullet.
    const m = line.match(/→\s*`([a-z]+)`\s*$/);
    if (m && CANONICAL_VALUES.has(m[1])) picker1Values.add(m[1]);
  }

  const silentActionValues = new Set<string>();
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (/\*\*Silent action[^*]*\*\*/.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && !/^\*\*/.test(lines[j].trim())) {
        const m = lines[j].match(/^-\s*`([a-z]+)`/);
        if (m && CANONICAL_VALUES.has(m[1])) silentActionValues.add(m[1]);
        j++;
      }
    }
  }

  return { key, ungated: false, picker1Values, silentActionValues };
}

function listGateFiles(): string[] {
  return fs
    .readdirSync(GATES_DIR)
    .filter((f) => f.endsWith(".md") && f !== "README.md")
    .map((f) => f.replace(/\.md$/, ""));
}

describe("preference-gate contract lint", () => {
  const skillRefs = listSkills().map(parseSkillGates);
  const allReferencedGates = new Set(skillRefs.flatMap((r) => r.gates));
  const gateFiles = listGateFiles();
  const gateContracts = new Map(
    gateFiles.map((k) => [k, parseGateFile(k)] as const),
  );

  describe("parser sanity: refuse to pass vacuously", () => {
    it("found at least one skill with gate references", () => {
      expect(
        skillRefs.some((r) => r.gates.length > 0),
        "no skill's Preferences table parsed any gate keys — parser likely broken",
      ).toBe(true);
    });
    it("found at least 10 gate contract files", () => {
      expect(gateFiles.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe("existence: every gate referenced by a skill has a contract file", () => {
    for (const ref of skillRefs) {
      for (const gate of ref.gates) {
        it(`${ref.skill} → ${gate}.md exists`, () => {
          expect(
            gateContracts.has(gate),
            `Skill ${ref.skill} references preference \`${gate}\` but no preference-gates/${gate}.md exists`,
          ).toBe(true);
        });
      }
    }
  });

  describe("no orphans: every gate file is referenced or explicitly ungated", () => {
    for (const [key, contract] of gateContracts) {
      it(`${key}.md is referenced or ungated`, () => {
        if (contract.ungated) return; // ungated knobs (e.g. verboseOutput) are exempt
        expect(
          allReferencedGates.has(key),
          `preference-gates/${key}.md is gated but no skill's Preferences table references it`,
        ).toBe(true);
      });
    }
  });

  describe("internal consistency: Picker 1 values match Silent-action values", () => {
    for (const [key, contract] of gateContracts) {
      if (contract.ungated) continue;
      // Some gate files (autoSelectProject, autoSelectLocalHost) render
      // Picker 1 via the calling skill rather than mapping bullets
      // directly — they have no Picker 1 `→ value` arrows. Skip the
      // bidirectional check for those, but still require their Silent
      // action set to be non-empty and canonical.
      if (contract.picker1Values.size === 0) {
        it(`${key}.md silent-action set is non-empty (Picker 1 is skill-rendered)`, () => {
          expect(
            contract.silentActionValues.size,
            `${key}.md has no Silent action values declared`,
          ).toBeGreaterThan(0);
          for (const v of contract.silentActionValues) {
            expect(CANONICAL_VALUES.has(v), `${key}.md silent action references unknown value \`${v}\``).toBe(true);
          }
        });
        continue;
      }
      it(`${key}.md Picker 1 values === Silent action values`, () => {
        const p = [...contract.picker1Values].sort();
        const s = [...contract.silentActionValues].sort();
        expect(
          p,
          `${key}.md mismatch — Picker 1 maps to {${p.join(",")}} but Silent action covers {${s.join(",")}}`,
        ).toEqual(s);
      });
    }
  });
});
