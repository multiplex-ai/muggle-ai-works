/**
 * Builds the JSON Schema each MCP tool advertises in tools/list.
 */

import { z } from "zod";

import { ZOD_PATTERN_BY_STRING_FORMAT } from "./tool-input-schema-constants.js";

/**
 * Converts a tool's Zod input schema to the JSON Schema served in tools/list, minus the keywords
 * that restate something already in the schema: the root `$schema` dialect, Zod's regex beside a
 * `format` that names the same constraint, and the ±(2^53 − 1) bounds Zod puts on every integer.
 * Every client loads this schema into its model's context, so those bytes are paid per session.
 * Input validation is unaffected — the server still parses arguments with the Zod schema.
 * @param inputSchema - The tool's Zod input schema.
 * @returns The JSON Schema for tools/list.
 */
export function buildToolInputJsonSchema (inputSchema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...schemaBody } = z.toJSONSchema(inputSchema) as Record<string, unknown>;
  return compactSchemaNode(schemaBody) as Record<string, unknown>;
}

function compactSchemaNode (node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(compactSchemaNode);
  }
  if (node === null || typeof node !== "object") {
    return node;
  }

  const schemaNode = node as Record<string, unknown>;
  const compactedNode: Record<string, unknown> = {};
  for (const [keyword, value] of Object.entries(schemaNode)) {
    if (!isRestatedKeyword(schemaNode, keyword, value)) {
      compactedNode[keyword] = compactSchemaNode(value);
    }
  }
  return compactedNode;
}

function isRestatedKeyword (schemaNode: Record<string, unknown>, keyword: string, value: unknown): boolean {
  // Each check compares a primitive value, so a property that merely shares a keyword's name
  // (its value is a schema object) is never dropped.
  switch (keyword) {
    case "pattern":
      return typeof schemaNode.format === "string" && ZOD_PATTERN_BY_STRING_FORMAT.get(schemaNode.format) === value;
    case "maximum":
      return value === Number.MAX_SAFE_INTEGER;
    case "minimum":
      return value === Number.MIN_SAFE_INTEGER;
    default:
      return false;
  }
}
