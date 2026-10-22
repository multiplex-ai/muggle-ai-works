/**
 * Tool-attempt patterns: matching one against a recorded attempt, describing
 * it in a verdict, and the load-time work a scenario file needs — checking a
 * pattern's shape and replacing `{ "pattern": "<name>" }` references with the
 * file's named patterns.
 */

import type {
  SingleToolAttemptPattern,
  ToolAttempt,
  ToolAttemptPattern,
  ToolAttemptPatternReference,
} from "./types.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSinglePattern(value: unknown): value is SingleToolAttemptPattern {
  if (typeof value !== "object" || value === null) return false;
  const { tool, argContains } = value as { tool?: unknown; argContains?: unknown };
  const isNeedleList =
    Array.isArray(argContains) && argContains.length > 0 && argContains.every((needle) => typeof needle === "string");
  return isNonEmptyString(tool) && (typeof argContains === "string" || isNeedleList);
}

function isAnyOfPattern(value: unknown): value is { anyOf: SingleToolAttemptPattern[] } {
  if (typeof value !== "object" || value === null) return false;
  const alternatives = (value as { anyOf?: unknown }).anyOf;
  return Array.isArray(alternatives) && alternatives.length > 0 && alternatives.every(isSinglePattern);
}

/** True for a well-formed pattern: `{ tool, argContains }` with a string or non-empty string list, or a non-empty `anyOf` of those. */
export function isToolAttemptPattern(value: unknown): value is ToolAttemptPattern {
  return isSinglePattern(value) || isAnyOfPattern(value);
}

function isPatternReference(value: unknown): value is ToolAttemptPatternReference {
  return typeof value === "object" && value !== null && typeof (value as { pattern?: unknown }).pattern === "string";
}

function singleAttemptMatches(attempt: ToolAttempt, pattern: SingleToolAttemptPattern): boolean {
  if (attempt.tool !== pattern.tool) return false;
  const serializedInput = JSON.stringify(attempt.args ?? {});
  const needles = typeof pattern.argContains === "string" ? [pattern.argContains] : pattern.argContains;
  return needles.every((needle) => serializedInput.includes(needle));
}

/** True when the attempt matches the pattern, or for `anyOf`, any one of its alternatives. */
export function toolAttemptMatches(attempt: ToolAttempt, pattern: ToolAttemptPattern): boolean {
  if ("anyOf" in pattern) return pattern.anyOf.some((alternative) => singleAttemptMatches(attempt, alternative));
  return singleAttemptMatches(attempt, pattern);
}

/**
 * The pattern as a verdict reason names it.
 *
 * Output shape: `Bash~"gh pr create"`, `Bash~["gh pr create","[E2E FAILING]"]`, or `anyOf(Skill~"loop" | Monitor~"pr-watch-arm.sh")`.
 */
export function describeToolAttemptPattern(pattern: ToolAttemptPattern): string {
  if ("anyOf" in pattern) return `anyOf(${pattern.anyOf.map(describeToolAttemptPattern).join(" | ")})`;
  return `${pattern.tool}~${JSON.stringify(pattern.argContains)}`;
}

/**
 * Replace each `{ "pattern": "<name>" }` in a scenario's pattern list with the
 * named pattern, and check every entry is well formed.
 *
 * @param listLabel - Names the list in an error, e.g. `Scenario "s" expect.requireToolSequence`.
 * @throws on a reference to an unknown name or an entry that is no pattern.
 */
export function resolvePatternReferences(
  entries: unknown[],
  namedPatterns: Record<string, ToolAttemptPattern>,
  listLabel: string,
): ToolAttemptPattern[] {
  return entries.map((entry, index) => {
    if (isPatternReference(entry)) {
      const named = namedPatterns[entry.pattern];
      if (!named) {
        throw new Error(`${listLabel}[${index}] names pattern "${entry.pattern}", which the file's patterns do not define`);
      }
      return named;
    }
    if (!isToolAttemptPattern(entry)) {
      throw new Error(`${listLabel}[${index}] must be { tool, argContains }, { anyOf: [...] }, or { pattern: "<name>" }`);
    }
    return entry;
  });
}
