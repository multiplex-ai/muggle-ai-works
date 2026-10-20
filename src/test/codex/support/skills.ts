import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

// The plugin's skills as Codex reads them, for the suites that hold them to
// Codex's rules.

export const SKILLS_DIR = fileURLToPath(new URL("../../../../plugin/skills", import.meta.url));

export const ALIASES = (JSON.parse(readFileSync(join(SKILLS_DIR, "_aliases.json"), "utf-8")) as { aliases: string[] })
  .aliases;

/** Every skill directory Codex loads a skill from. */
export const SKILL_NAMES = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, "SKILL.md")))
  .map((entry) => entry.name);

/** The skills Codex shows the model; aliases are typed by the user only. */
export const CANONICAL_SKILLS = SKILL_NAMES.filter((name) => !ALIASES.includes(name));

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;

export function skillMarkdown(skillName: string): string {
  return readFileSync(join(SKILLS_DIR, skillName, "SKILL.md"), "utf-8");
}

export function frontmatter(skillName: string): string {
  return FRONTMATTER.exec(skillMarkdown(skillName))?.[1] ?? "";
}

/** One top-level frontmatter scalar, unquoted the way YAML does for the forms the skills use. */
export function frontmatterScalar(skillName: string, field: string): string | undefined {
  const raw = new RegExp(`^${field}:[ \\t]*(.+)$`, "m").exec(frontmatter(skillName))?.[1]?.trim();
  if (raw === undefined) return undefined;
  if (raw.startsWith('"')) return JSON.parse(raw) as string;
  if (raw.startsWith("'")) return raw.slice(1, -1).replaceAll("''", "'");
  return raw;
}

/** A skill's description as Codex renders it: collapsed to one line. */
export function skillDescription(skillName: string): string {
  return (frontmatterScalar(skillName, "description") ?? "").split(/\s+/).filter(Boolean).join(" ");
}

/**
 * The line Codex writes for a skill in the model's skills list
 * (codex-rs/ext/skills/src/render.rs), with the plugin's skill root aliased.
 */
export function catalogLine(skillName: string): string {
  return `- muggle:${skillName}: ${skillDescription(skillName)} (file: r1/${skillName}/SKILL.md)`;
}
