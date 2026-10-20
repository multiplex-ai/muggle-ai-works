import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { join } from "path";

// Codex loads these skills from the plugin unchanged. It drops a skill whose
// SKILL.md breaks its rules without telling anyone, and it reads the policy of
// an alias from agents/openai.yaml rather than Claude Code's frontmatter key, so
// both are pinned here rather than discovered by a user whose skill is missing.
const SKILLS_ROOT = fileURLToPath(new URL("../../../plugin/skills", import.meta.url));
const ALIASES = (JSON.parse(readFileSync(join(SKILLS_ROOT, "_aliases.json"), "utf-8")) as { aliases: string[] })
  .aliases;

// Codex's SKILL.md parser: `name` at most 64 characters, a non-empty `description`.
const CODEX_MAX_SKILL_NAME_LENGTH = 64;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

const skillDirectories = readdirSync(SKILLS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_ROOT, entry.name, "SKILL.md")))
  .map((entry) => entry.name);
const canonicalSkills = skillDirectories.filter((name) => !ALIASES.includes(name));

function frontmatterField(skillName: string, field: string): string | undefined {
  const frontmatter = FRONTMATTER.exec(readFileSync(join(SKILLS_ROOT, skillName, "SKILL.md"), "utf-8"))?.[1] ?? "";
  return new RegExp(`^${field}:\\s*(.+)$`, "m").exec(frontmatter)?.[1]?.trim();
}

describe("skills Codex can load", () => {
  it("finds every shipped skill", () => {
    expect(canonicalSkills.length).toBeGreaterThanOrEqual(15);
    expect(ALIASES.every((alias) => skillDirectories.includes(alias))).toBe(true);
  });

  it.each(skillDirectories)("%s has a name and description Codex accepts", (skillName) => {
    const name = frontmatterField(skillName, "name");
    expect(name).toBe(skillName);
    expect(name!.length).toBeLessThanOrEqual(CODEX_MAX_SKILL_NAME_LENGTH);
    expect(frontmatterField(skillName, "description")?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("alias skills under Codex", () => {
  // Claude Code reads `disable-model-invocation: true`; Codex reads this.
  it.each(ALIASES)("%s is for the user to type, never for Codex to pick on its own", (alias) => {
    const policyPath = join(SKILLS_ROOT, alias, "agents", "openai.yaml");
    expect(existsSync(policyPath), policyPath).toBe(true);
    expect(readFileSync(policyPath, "utf-8")).toMatch(/^policy:\n {2}allow_implicit_invocation: false$/m);
    expect(frontmatterField(alias, "disable-model-invocation")).toBe("true");
  });

  it.each(ALIASES)("%s says how to reach its skill in a host with no Skill tool", (alias) => {
    expect(readFileSync(join(SKILLS_ROOT, alias, "SKILL.md"), "utf-8")).toMatch(
      /no Skill tool \(Codex\), open `\.\.\/[a-z-]+\/SKILL\.md`/,
    );
  });
});

describe("canonical skills under Codex", () => {
  it.each(canonicalSkills)("%s points a non-Claude host at the tool equivalents", (skillName) => {
    expect(readFileSync(join(SKILLS_ROOT, skillName, "SKILL.md"), "utf-8")).toContain(
      "](../_shared/host-tool-equivalents.md)",
    );
  });
});
