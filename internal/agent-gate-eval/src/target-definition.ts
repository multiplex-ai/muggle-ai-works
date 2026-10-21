/** Loads whichever kind of target a scenario file names, and locates the plugin tree it belongs to. */

import * as path from "node:path";

import { loadAgentDefinition } from "./agent-definition.js";
import { loadSkillDefinition } from "./skill-definition.js";
import {
  EvalTargetKind,
  type EvalTarget,
  type TargetDefinition,
  type TargetDirectories,
} from "./types.js";

/**
 * Load a scenario file's target.
 *
 * @param modelOverride - Applies to skill targets only; an agent always runs on its pin.
 * @throws when the agent's frontmatter name differs from the target's name.
 */
export function loadTargetDefinition(
  target: EvalTarget,
  directories: TargetDirectories,
  modelOverride?: string,
): TargetDefinition {
  if (target.kind === EvalTargetKind.Skill) {
    return loadSkillDefinition(directories.skillsDir, target.name, modelOverride);
  }
  const definition = loadAgentDefinition(directories.agentsDir, target.name);
  if (definition.name !== target.name) {
    throw new Error(`Scenario file is for agent ${target.name}, not ${definition.name}`);
  }
  return definition;
}

/** The plugin tree a target's definition sits in: `plugin/` for `plugin/agents/<name>.md` and `plugin/skills/<name>/SKILL.md`. */
export function pluginRootOf(definition: TargetDefinition): string {
  return definition.kind === EvalTargetKind.Skill
    ? path.dirname(path.dirname(definition.baseDir))
    : path.dirname(path.dirname(path.resolve(definition.filePath)));
}
