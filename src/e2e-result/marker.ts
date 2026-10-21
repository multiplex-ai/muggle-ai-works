import { z } from "zod";

import { E2E_RESULT_MARKER_PREFIX, E2E_RESULT_MARKER_SUFFIX } from "./constants.js";
import { UnpassedCaseStatus, type IE2eResultRecord } from "./types.js";

const UnpassedCaseSchema = z.object({
  name: z.string(),
  testCaseId: z.string(),
  status: z.enum(UnpassedCaseStatus),
  failedStep: z.number().int().positive().optional(),
  detail: z.string(),
  viewUrl: z.string(),
});

const E2eResultRecordSchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  unpassed: z.array(UnpassedCaseSchema),
});

/**
 * The hidden line that carries a record inside a walkthrough comment.
 *
 * `<` and `>` are written as JSON unicode escapes, so an error message holding
 * `-->` can never close the HTML comment early and spill the record onto the
 * page; `JSON.parse` reads the escapes back unchanged.
 */
export function renderE2eResultMarker(record: IE2eResultRecord): string {
  const json = JSON.stringify(record).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `${E2E_RESULT_MARKER_PREFIX}${json}${E2E_RESULT_MARKER_SUFFIX}`;
}

/**
 * The record one comment body carries.
 *
 * @returns `null` when the body has no marker or the marker does not parse.
 */
export function parseE2eResultMarker(body: string): IE2eResultRecord | null {
  const start = body.indexOf(E2E_RESULT_MARKER_PREFIX);
  if (start === -1) return null;
  const jsonStart = start + E2E_RESULT_MARKER_PREFIX.length;
  const end = body.indexOf(E2E_RESULT_MARKER_SUFFIX, jsonStart);
  if (end === -1) return null;
  try {
    const parsed = E2eResultRecordSchema.safeParse(JSON.parse(body.slice(jsonStart, end)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The record that currently stands for a PR: the newest comment carrying one.
 * A re-run that posts a fresh walkthrough instead of editing the old one
 * supersedes it.
 *
 * @param bodies - Comment bodies, oldest first, as the provider lists them.
 */
export function latestE2eResult(bodies: readonly string[]): IE2eResultRecord | null {
  for (let i = bodies.length - 1; i >= 0; i--) {
    const record = parseE2eResultMarker(bodies[i]);
    if (record) return record;
  }
  return null;
}
