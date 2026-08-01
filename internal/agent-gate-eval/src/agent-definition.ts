/** Parses a `plugin/agents/<name>.md` definition into the eval's AgentDefinition. */

import * as fs from "node:fs";
import * as path from "node:path";

import { MODEL_ALIASES } from "../../skill-gate-eval/src/constants.js";
import type { AgentDefinition } from "./types.js";

/**
 * Load and parse one agent definition file.
 *
 * Output shape: `{ name, modelAlias, model, body, filePath }` — throws when the
 * frontmatter is missing `name:` or `model:`, or when the alias is unknown; the
 * pin is the point of the eval, so an unpinned agent is a hard error, not a
 * silent default.
 */
export function loadAgentDefinition(agentsDir: string, agentName: string): AgentDefinition {
  const filePath = path.resolve(agentsDir, `${agentName}.md`);
  const raw = fs.readFileSync(filePath, "utf8");
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!frontmatterMatch) {
    throw new Error(`${filePath} has no frontmatter block`);
  }
  const block = frontmatterMatch[1];
  const nameMatch = block.match(/^name:[ \t]*"?(.+?)"?[ \t]*$/m);
  const modelMatch = block.match(/^model:[ \t]*"?(.+?)"?[ \t]*$/m);
  if (!nameMatch) throw new Error(`${filePath} frontmatter has no name:`);
  if (!modelMatch) {
    throw new Error(`${filePath} frontmatter has no model: — agent pins are the contract under test`);
  }
  const modelAlias = modelMatch[1].trim();
  const model = MODEL_ALIASES[modelAlias];
  if (!model) {
    throw new Error(
      `${filePath} pins unknown model alias "${modelAlias}" — known: ${Object.keys(MODEL_ALIASES).join(", ")}`,
    );
  }
  return {
    name: nameMatch[1].trim(),
    modelAlias: modelAlias,
    model: model,
    body: raw.slice(frontmatterMatch[0].length),
    filePath: filePath,
  };
}
