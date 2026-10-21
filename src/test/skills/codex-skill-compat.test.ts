import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  ALIASES,
  CANONICAL_SKILLS,
  SKILLS_DIR,
  SKILL_NAMES,
  catalogLine,
  frontmatter,
  frontmatterScalar,
  skillDescription,
  skillMarkdown,
} from "../codex/support/skills.js";

// Codex loads these skills from the plugin unchanged, and it fails them
// quietly: a SKILL.md that breaks its parser is dropped with nothing but a log
// line, an agents/openai.yaml with one mistyped field is ignored whole (taking
// the alias's policy with it), and a description that does not fit is cut
// without a word. Each rule below is Codex 0.163.0's own, from
// codex-rs/skills/src/parser.rs and codex-rs/ext/skills/src (render.rs,
// loader/metadata.rs, interface.rs), pinned here rather than discovered by a
// user whose skill is missing.

const CODEX_MAX_SKILL_NAME_LENGTH = 64;
// A longer description is cut to 1,021 characters and "...".
const CODEX_MAX_SKILL_DESCRIPTION_LENGTH = 1024;
// What a `$muggle:<name>` mention can spell; the mention ends at any other character.
const CODEX_MENTIONABLE_NAME = /^[A-Za-z0-9_-]+$/;
// The skills list's budget is 2% of the model's context window (272,000 for
// every bundled model), counted at a token per 4 bytes. Past it Codex trims
// descriptions round-robin — plugin skills are listed last — with no warning.
// Muggle keeps to a share of it so Codex's own skills and the user's still fit.
const CODEX_SKILLS_BUDGET_BYTES = 272_000 * 0.02 * 4;
const MUGGLE_SHARE_OF_SKILLS_BUDGET = 0.6;
// openai.yaml interface limits; an over-long field is dropped with a warning nobody sees.
const CODEX_MAX_DISPLAY_NAME_LENGTH = 64;
const CODEX_MAX_SHORT_DESCRIPTION_LENGTH = 1024;
const CODEX_OPENAI_YAML_SECTIONS = ["interface", "policy", "dependencies"];

/** The two-level mapping an agents/openai.yaml holds, with each value as written. */
function openAiYaml(alias: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const line of readFileSync(join(SKILLS_DIR, alias, "agents", "openai.yaml"), "utf-8").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const section = /^([A-Za-z_]+):\s*$/.exec(line);
    if (section) {
      current = new Map();
      sections.set(section[1], current);
      continue;
    }
    const field = /^ {2}([A-Za-z_]+):\s*(.+)$/.exec(line);
    if (!field || !current) throw new Error(`${alias}/agents/openai.yaml: unexpected line ${JSON.stringify(line)}`);
    current.set(field[1], field[2].trim());
  }
  return sections;
}

const yamlString = (raw: string | undefined): string =>
  raw === undefined ? "" : raw.startsWith('"') ? (JSON.parse(raw) as string) : raw;

describe("skills Codex can load", () => {
  it("finds every shipped skill", () => {
    expect(CANONICAL_SKILLS.length).toBeGreaterThanOrEqual(15);
    expect(ALIASES.every((alias) => SKILL_NAMES.includes(alias))).toBe(true);
  });

  it.each(SKILL_NAMES)("%s opens with the frontmatter fence Codex looks for", (skillName) => {
    const markdown = skillMarkdown(skillName);
    expect(markdown.charCodeAt(0), "a byte-order mark hides the fence").not.toBe(0xfeff);
    expect(markdown.split(/\r?\n/, 1)[0].trim()).toBe("---");
  });

  it.each(SKILL_NAMES)("%s has a name `$muggle:<name>` can reach", (skillName) => {
    const name = frontmatterScalar(skillName, "name");
    expect(name).toBe(skillName);
    expect(name!.length).toBeLessThanOrEqual(CODEX_MAX_SKILL_NAME_LENGTH);
    expect(name).toMatch(CODEX_MENTIONABLE_NAME);
  });

  it.each(SKILL_NAMES)("%s has a description Codex renders whole", (skillName) => {
    const description = skillDescription(skillName);
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(CODEX_MAX_SKILL_DESCRIPTION_LENGTH);
  });

  // `metadata` is the one key Codex types strictly; a scalar there fails the whole skill.
  it.each(SKILL_NAMES)("%s carries no metadata Codex would reject", (skillName) => {
    expect(frontmatter(skillName)).not.toMatch(/^metadata:[ \t]*\S/m);
  });

  it("lists to the model within Muggle's share of Codex's skills budget", () => {
    const bytes = CANONICAL_SKILLS.reduce((total, skill) => total + Buffer.byteLength(`${catalogLine(skill)}\n`), 0);
    expect(bytes).toBeLessThanOrEqual(CODEX_SKILLS_BUDGET_BYTES * MUGGLE_SHARE_OF_SKILLS_BUDGET);
  });
});

describe("alias skills under Codex", () => {
  // Claude Code reads `disable-model-invocation: true`; Codex reads this.
  it.each(ALIASES)("%s is for the user to type, never for Codex to pick on its own", (alias) => {
    const policyPath = join(SKILLS_DIR, alias, "agents", "openai.yaml");
    expect(existsSync(policyPath), policyPath).toBe(true);
    // A quoted "false" is a string, and a mistyped field voids the whole file.
    expect(openAiYaml(alias).get("policy")?.get("allow_implicit_invocation")).toBe("false");
    expect(frontmatterScalar(alias, "disable-model-invocation")).toBe("true");
  });

  it.each(ALIASES)("%s has an agents/openai.yaml Codex parses whole", (alias) => {
    const sections = openAiYaml(alias);
    expect([...sections.keys()].filter((section) => !CODEX_OPENAI_YAML_SECTIONS.includes(section))).toEqual([]);
    // A products list that leaves Codex out drops the skill for Codex altogether.
    expect(sections.get("policy")?.has("products")).toBe(false);
    const interfaceFields = sections.get("interface");
    expect(yamlString(interfaceFields?.get("display_name"))).toBe(alias);
    expect(yamlString(interfaceFields?.get("display_name")).length).toBeLessThanOrEqual(CODEX_MAX_DISPLAY_NAME_LENGTH);
    expect(yamlString(interfaceFields?.get("short_description")).length).toBeLessThanOrEqual(
      CODEX_MAX_SHORT_DESCRIPTION_LENGTH,
    );
  });

  it.each(ALIASES)("%s says how to reach its skill in a host with no Skill tool", (alias) => {
    expect(skillMarkdown(alias)).toMatch(/no Skill tool \(Codex\), open `\.\.\/[a-z-]+\/SKILL\.md`/);
  });
});

describe("canonical skills under Codex", () => {
  it.each(CANONICAL_SKILLS)("%s points a non-Claude host at the tool equivalents", (skillName) => {
    expect(skillMarkdown(skillName)).toContain("](../_shared/host-tool-equivalents.md)");
  });
});
