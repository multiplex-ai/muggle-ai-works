/** Splits a plugin agent or skill definition at its frontmatter and reads single-line fields from it. */

import type { ParsedFrontmatter } from "./types.js";

/**
 * Split a definition file's text at its frontmatter fence.
 *
 * @throws when the text has no frontmatter block.
 */
export function splitFrontmatter(raw: string, filePath: string): ParsedFrontmatter {
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!frontmatterMatch) {
    throw new Error(`${filePath} has no frontmatter block`);
  }
  return { block: frontmatterMatch[1], body: raw.slice(frontmatterMatch[0].length) };
}

/** A single-line frontmatter field's value, quotes stripped, or undefined when the key is absent or empty. */
export function frontmatterField(block: string, key: string): string | undefined {
  const fieldMatch = block.match(new RegExp(`^${key}:[ \\t]*"?(.+?)"?[ \\t]*$`, "m"));
  return fieldMatch ? fieldMatch[1].trim() : undefined;
}
