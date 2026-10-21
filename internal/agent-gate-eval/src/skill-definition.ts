/**
 * Loads a skill target and builds the message its invocation injects, the way
 * the Skill tool does: a base-directory line, so the body's relative stage
 * links resolve from the skill's own directory, then the body with the
 * invocation's arguments.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { MODEL_ALIASES } from "../../skill-gate-eval/src/constants.js";
import {
  DEFAULT_SKILL_MODEL,
  SKILL_ARGUMENTS_PLACEHOLDER,
  SKILL_ARGUMENTS_PREFIX,
  SKILL_BASE_DIRECTORY_PREFIX,
} from "./constants.js";
import { frontmatterField, splitFrontmatter } from "./frontmatter.js";
import { EvalTargetKind, type SkillDefinition } from "./types.js";

/**
 * The model a skill runs on: `modelOverride`, else the frontmatter pin, else
 * DEFAULT_SKILL_MODEL. An alias (haiku/sonnet/opus/…) resolves through
 * MODEL_ALIASES; an override that is no alias is taken as a model id.
 *
 * @throws when the frontmatter pins an unknown alias.
 */
export function resolveSkillModel(
  modelOverride: string | undefined,
  modelAlias: string | undefined,
  filePath: string,
): string {
  if (modelOverride) return MODEL_ALIASES[modelOverride] ?? modelOverride;
  if (!modelAlias) return DEFAULT_SKILL_MODEL;
  const model = MODEL_ALIASES[modelAlias];
  if (!model) {
    throw new Error(
      `${filePath} pins unknown model alias "${modelAlias}" — known: ${Object.keys(MODEL_ALIASES).join(", ")}`,
    );
  }
  return model;
}

/**
 * Load and parse `<skillsDir>/<skillName>/SKILL.md`.
 *
 * Output shape: `{ kind: "skill", name, modelAlias?, model, body, filePath, baseDir }`.
 *
 * @param modelOverride - The runner's `--model`, which outranks the skill's pin.
 */
export function loadSkillDefinition(
  skillsDir: string,
  skillName: string,
  modelOverride?: string,
): SkillDefinition {
  const baseDir = path.resolve(skillsDir, skillName);
  const filePath = path.join(baseDir, "SKILL.md");
  const { block, body } = splitFrontmatter(fs.readFileSync(filePath, "utf8"), filePath);
  const modelAlias = frontmatterField(block, "model");
  return {
    kind: EvalTargetKind.Skill,
    name: frontmatterField(block, "name") ?? skillName,
    modelAlias: modelAlias,
    model: resolveSkillModel(modelOverride, modelAlias, filePath),
    body: body,
    filePath: filePath,
    baseDir: baseDir,
  };
}

/**
 * The user message a typed `/<skill> <args>` becomes: the command and its
 * arguments, then the skill as the Skill tool injects it. The arguments also
 * replace every `$ARGUMENTS` in the body; a body without the placeholder gets
 * them appended. Without the command lines, a body that only mentions
 * `$ARGUMENTS` mid-prose hides the request, and the session reports it got none.
 *
 * Output shape:
 *
 *     <command-name>/muggle-do</command-name>
 *     <command-args>rebase on https://github.com/o/r/pull/1 slug=s</command-args>
 *
 *     Base directory for this skill: /repo/plugin/skills/muggle-do
 *
 *     # Muggle Test Do
 *     …
 */
export function buildSkillInvocationMessage(definition: SkillDefinition, invocationArgs: string): string {
  const hasPlaceholder = definition.body.includes(SKILL_ARGUMENTS_PLACEHOLDER);
  const body = hasPlaceholder
    ? definition.body.split(SKILL_ARGUMENTS_PLACEHOLDER).join(invocationArgs)
    : definition.body;
  const sections = [
    `<command-name>/${definition.name}</command-name>\n<command-args>${invocationArgs}</command-args>`,
    `${SKILL_BASE_DIRECTORY_PREFIX}${definition.baseDir}`,
    body.trim(),
  ];
  if (!hasPlaceholder && invocationArgs) sections.push(`${SKILL_ARGUMENTS_PREFIX}${invocationArgs}`);
  return sections.join("\n\n");
}
