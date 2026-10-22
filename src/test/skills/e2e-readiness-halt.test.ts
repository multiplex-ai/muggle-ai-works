/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins what muggle-do does when the dev server is down at E2E time. Three files
 * used to disagree — Stage 6 said "halt", the Definition of Done accepted a
 * `DEV_SERVER_UNREACHABLE` skip for any SKIPPED exit, and Stage 7.5 auto-waived
 * unattended failures — so agents declared the skip and opened an unverified PR.
 * The halt holds only while all three say the same thing.
 *
 * Prose is the implementation here. These assertions do NOT catch an agent that
 * reads the rule and ignores it; the muggle-do.handoff `dev-server-down`
 * scenario does.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "plugin", "skills");
const E2E_ACCEPTANCE_DOC = path.join(SKILLS_DIR, "do", "e2e-acceptance.md");
const E2E_REPAIR_DOC = path.join(SKILLS_DIR, "do", "e2e-repair.md");
const MUGGLE_DO_SKILL_DOC = path.join(SKILLS_DIR, "muggle-do", "SKILL.md");

const read = (docPath: string): string => fs.readFileSync(docPath, "utf8");

/** Body of the first heading matching `headingPattern`, up to the next heading of the same or higher level. */
function sectionBody(doc: string, headingPattern: RegExp): string {
  const heading = doc.match(headingPattern);
  if (!heading || heading.index === undefined) return "";
  const level = heading[0].match(/^#+/)![0].length;
  const rest = doc.slice(heading.index + heading[0].length);
  const nextHeading = rest.search(new RegExp(String.raw`^#{1,${level}} `, "m"));
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

const readinessStep = sectionBody(read(E2E_ACCEPTANCE_DOC), /^### Step 0\.5\b.*$/m);
const authStep = sectionBody(read(E2E_ACCEPTANCE_DOC), /^### Step 1:.*$/m);
const definitionOfDone = sectionBody(read(MUGGLE_DO_SKILL_DOC), /^### Definition of Done.*$/m);
const clearanceCheck = sectionBody(read(E2E_REPAIR_DOC), /^## Step 0\b.*$/m);
const userDecision = sectionBody(read(E2E_REPAIR_DOC), /^## Step 4\b.*$/m);

describe("parser sanity: refuse to pass vacuously", () => {
  it("finds every section under test", () => {
    for (const [name, body] of Object.entries({
      readinessStep: readinessStep,
      authStep: authStep,
      definitionOfDone: definitionOfDone,
      clearanceCheck: clearanceCheck,
      userDecision: userDecision,
    })) {
      expect(body.length, `section not found or empty: ${name}`).toBeGreaterThan(100);
    }
  });
});

describe("Stage 6 checks readiness before any browser run", () => {
  it("places the readiness step ahead of the dev-loop run", () => {
    const doc = read(E2E_ACCEPTANCE_DOC);
    const readinessAt = doc.search(/^### Step 0\.5\b/m);
    const runAt = doc.search(/^### Step 4\b/m);
    expect(readinessAt).toBeGreaterThanOrEqual(0);
    expect(runAt).toBeGreaterThan(readinessAt);
  });

  it("invokes muggle-test-prepare before any local execute call", () => {
    expect(readinessStep).toMatch(/\]\(\.\.\/muggle-test-prepare\/SKILL\.md\)/);
    expect(readinessStep).toMatch(/before any `muggle-local-execute-\*` call/);
  });

  it("re-checks every cycle even when pre-flight already found the app ready", () => {
    expect(readinessStep).toMatch(/every cycle/);
    expect(readinessStep).toMatch(/even when pre-flight already reported the app ready/);
  });
});

describe("an app that cannot be brought up halts the cycle", () => {
  it("names the halt instead of a bare 'halt on failure'", () => {
    expect(readinessStep).toMatch(/\*\*Readiness halt\.\*\*/);
    expect(readinessStep).not.toMatch(/Halt on failure/);
  });

  it("is not a skip and cannot be waived", () => {
    expect(readinessStep).toMatch(/never a `SKIPPED` exit/);
    expect(readinessStep).toMatch(/declare no skip code/);
    expect(readinessStep).toMatch(/write no waiver/);
  });

  it("stops the forward cycle before the PR, walkthrough, repair loop, and watcher", () => {
    for (const downstream of [/opens no PR/, /posts no walkthrough/, /runs no Stage 7\.5/, /arms no watcher/]) {
      expect(readinessStep).toMatch(downstream);
    }
  });

  it("reports what was tried and waits for the user, unattended or not", () => {
    expect(readinessStep).toMatch(/URL probed/);
    expect(readinessStep).toMatch(/what `muggle-test-prepare` tried/);
    expect(readinessStep).toMatch(/wait for the user/);
    expect(readinessStep).toMatch(/unattended runs/);
    expect(readinessStep).toMatch(/request that asked for the PR/);
  });

  it("treats a run that never reached the app as the same halt", () => {
    expect(readinessStep).toMatch(/connection refused/);
  });

  it("is not listed among the stage's SKIPPED exits", () => {
    const skippedExits = read(E2E_ACCEPTANCE_DOC).match(/^\*\*Every SKIPPED exit from this stage\*\*.*$/m);
    expect(skippedExits).not.toBeNull();
    expect(skippedExits![0]).not.toMatch(/Step 0\.5|readiness/i);
  });
});

describe("DEV_SERVER_UNREACHABLE belongs to unit-only and skip validation only", () => {
  it("Stage 6 ties the code to the unit-only/skip exit and sends local-e2e to the halt", () => {
    const exitParagraph = authStep.split(/\n\s*\n/).find((p) => p.includes("DEV_SERVER_UNREACHABLE"));
    expect(exitParagraph).toBeDefined();
    expect(exitParagraph!).toMatch(/`unit-only` or `skip`/);
    expect(exitParagraph!).toMatch(/only exit `DEV_SERVER_UNREACHABLE` belongs to/);
    expect(exitParagraph!).toMatch(/`local-e2e` cycle an unreachable server is the Step 0\.5 readiness halt/);
  });

  it("the Definition of Done refuses to close the E2E line on a readiness halt", () => {
    expect(definitionOfDone).toMatch(/readiness halt \(\[`\.\.\/do\/e2e-acceptance\.md`\]\(\.\.\/do\/e2e-acceptance\.md\) Step 0\.5\)/);
    expect(definitionOfDone).toMatch(/no skip code, waiver, or explicit request to open the PR closes it/);
  });
});

describe("Stage 7.5 never auto-waives a readiness failure", () => {
  it("routes a run that never reached the app back to the Stage 6 halt", () => {
    expect(clearanceCheck).toMatch(/never reached the app/);
    expect(clearanceCheck).toMatch(/\[`e2e-acceptance\.md`\]\(e2e-acceptance\.md\) Step 0\.5/);
    expect(clearanceCheck).toMatch(/nothing to repair and nothing to waive, attended or not/);
  });

  it("checks for it before the repair loop claims the entry", () => {
    const readinessAt = clearanceCheck.search(/never reached the app/);
    const loopAt = clearanceCheck.search(/the loop runs over every entry/);
    expect(readinessAt).toBeGreaterThanOrEqual(0);
    expect(loopAt).toBeGreaterThan(readinessAt);
  });

  it("excludes it from the unattended automatic waive", () => {
    const unattended = userDecision.split(/\n\s*\n/).find((p) => p.startsWith("**Unattended runs.**"));
    expect(unattended).toBeDefined();
    expect(unattended!).toMatch(/automatic waive/);
    expect(unattended!).toMatch(/readiness halt \(Step 0\) is not an `ask` and is never auto-waived/);
  });
});
