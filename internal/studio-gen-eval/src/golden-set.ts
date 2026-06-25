import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { type GoldenCase, type GoldenSet } from "./types.js";

type HashableCase = Pick<GoldenCase, "url" | "goal" | "precondition" | "instructions" | "expectedResult">;

/** Stable hash over the generation-relevant fields; powers drift detection. */
export function bodyHash (c: HashableCase): string {
  const normalised = JSON.stringify({
    url: c.url.trim(),
    goal: c.goal.trim(),
    precondition: c.precondition.trim(),
    instructions: c.instructions.trim(),
    expectedResult: c.expectedResult.trim(),
  });
  return createHash("sha256").update(normalised).digest("hex").slice(0, 16);
}

export function loadGoldenSet (file: string): GoldenSet {
  return JSON.parse(fs.readFileSync(file, "utf8")) as GoldenSet;
}

export function saveGoldenSet (file: string, set: GoldenSet): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(set, null, 2)}\n`);
}

/**
 * Golden cases whose live content no longer matches the committed snapshot.
 * `liveHashes` maps testCaseId → freshly computed bodyHash; ids absent from the
 * map are skipped (treated as unknown, not drifted).
 */
export function detectDrift (set: GoldenSet, liveHashes: Map<string, string>): GoldenCase[] {
  return set.cases.filter((c) => {
    const live = liveHashes.get(c.testCaseId);
    return live !== undefined && live !== c.bodyHash;
  });
}
