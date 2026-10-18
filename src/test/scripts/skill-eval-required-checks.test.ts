import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const workflowPath = fileURLToPath(
  new URL("../../../.github/workflows/skill-eval.yml", import.meta.url),
);

// Mirrors master's branch protection. Renaming one of these jobs without
// updating the protection leaves the old check pending and blocks every PR.
const requiredEvalChecks = ["skill-gate-eval", "agent-gate-eval", "skill-routing-eval"];

const workflowLines = readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n").split("\n");

/** Returns the lines under a top-level `key:`, up to the next top-level key. */
function topLevelBlock(key: string): string[] {
  const start = workflowLines.indexOf(`${key}:`);
  if (start < 0) throw new Error(`top-level "${key}:" not found in skill-eval.yml`);
  const end = workflowLines.findIndex((line, index) => index > start && /^\S/.test(line));
  return workflowLines.slice(start + 1, end < 0 ? undefined : end);
}

/** Maps each job id under `jobs:` to its body lines. */
function jobBodiesById(): Map<string, string[]> {
  const bodies = new Map<string, string[]>();
  let currentBody: string[] | undefined;
  for (const line of topLevelBlock("jobs")) {
    const jobHeader = /^ {2}([\w-]+):\s*$/.exec(line);
    if (jobHeader) {
      currentBody = [];
      bodies.set(jobHeader[1], currentBody);
    } else {
      currentBody?.push(line);
    }
  }
  return bodies;
}

/** Splits a job body into one line list per step, comments dropped. */
function stepsOf(jobBody: string[]): string[][] {
  const steps: string[][] = [];
  for (const line of jobBody) {
    if (/^\s*#/.test(line)) continue;
    if (/^ {6}- /.test(line)) steps.push([line]);
    else if (steps.length > 0 && /^ {8}/.test(line)) steps[steps.length - 1].push(line);
  }
  return steps;
}

describe("skill-eval required checks", () => {
  const jobBodies = jobBodiesById();

  it.each(requiredEvalChecks)("defines the required job %s", (jobId) => {
    expect(jobBodies.has(jobId)).toBe(true);
  });

  // A job skipped by its own `if:` never reports, so its required check stays pending.
  it.each(requiredEvalChecks)("never skips %s at the job level", (jobId) => {
    expect(jobBodies.get(jobId)?.filter((line) => /^ {4}if:/.test(line))).toEqual([]);
  });

  it("triggers on every pull request regardless of the paths it touches", () => {
    expect(topLevelBlock("on").filter((line) => /^\s+paths(-ignore)?:/.test(line))).toEqual([]);
  });

  // Dependabot PRs get no Actions secrets, so an ungated secret read fails the
  // required check on a diff the eval would have scoped out.
  it.each(requiredEvalChecks)("reads secrets in %s only once scope says the eval runs", (jobId) => {
    const ungatedSecretSteps = stepsOf(jobBodies.get(jobId) ?? [])
      .filter((step) => step.some((line) => line.includes("${{ secrets.")))
      .filter(
        (step) =>
          !step.some((line) => /^ {8}if: .*steps\.scope\.outputs\.should_run == 'true'/.test(line)),
      )
      .map((step) => step[0].trim());
    expect(ungatedSecretSteps).toEqual([]);
  });
});
