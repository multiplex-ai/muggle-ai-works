/** Parses a `plugin/agents/<name>.md` definition into the eval's AgentDefinition. */

import * as fs from "node:fs";
import * as path from "node:path";

import { MODEL_ALIASES } from "../../skill-gate-eval/src/constants.js";
import { frontmatterField, splitFrontmatter } from "./frontmatter.js";
import { EvalTargetKind, type AgentDefinition } from "./types.js";

/**
 * Load and parse one agent definition file.
 *
 * Output shape: `{ kind: "agent", name, modelAlias, model, body, filePath }` — throws
 * when the frontmatter is missing `name:` or `model:`, or when the alias is unknown;
 * the pin is the point of the eval, so an unpinned agent is a hard error, not a
 * silent default.
 */
export function loadAgentDefinition(agentsDir: string, agentName: string): AgentDefinition {
  const filePath = path.resolve(agentsDir, `${agentName}.md`);
  const { block, body } = splitFrontmatter(fs.readFileSync(filePath, "utf8"), filePath);
  const name = frontmatterField(block, "name");
  const modelAlias = frontmatterField(block, "model");
  if (!name) throw new Error(`${filePath} frontmatter has no name:`);
  if (!modelAlias) {
    throw new Error(`${filePath} frontmatter has no model: — agent pins are the contract under test`);
  }
  const model = MODEL_ALIASES[modelAlias];
  if (!model) {
    throw new Error(
      `${filePath} pins unknown model alias "${modelAlias}" — known: ${Object.keys(MODEL_ALIASES).join(", ")}`,
    );
  }
  return {
    kind: EvalTargetKind.Agent,
    name: name,
    modelAlias: modelAlias,
    model: model,
    body: body,
    filePath: filePath,
  };
}
