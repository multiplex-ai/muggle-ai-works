/**
 * Constants for the JSON Schema each MCP tool advertises in tools/list.
 */

import { z } from "zod";

/**
 * The regex Zod writes beside each string `format` the tool surface uses, keyed by that format.
 * Read from Zod itself so the match stays exact across Zod upgrades; a custom `.regex()` never equals it.
 */
export const ZOD_PATTERN_BY_STRING_FORMAT: ReadonlyMap<string, unknown> = new Map([
  ["uuid", z.toJSONSchema(z.uuid()).pattern],
  ["email", z.toJSONSchema(z.email()).pattern],
]);
