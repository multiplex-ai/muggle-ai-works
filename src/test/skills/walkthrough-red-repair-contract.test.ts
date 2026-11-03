/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins what a red `muggle-walkthrough` check drives. Failed cases route into
 * the E2E repair loop; an empty comment is posted or awaited, never code-fixed;
 * a `NO_APP_LOGIC_CHANGE` skip over a failed run clears nothing; and whatever
 * the loop cannot repair ends as a decision the watcher keeps in front of the
 * owner — never a silent block or a waiver nobody gave.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { sectionBody } from "./helpers/markdown-sections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, "../../../plugin/skills");

const read = (...segments: string[]): string => fs.readFileSync(path.join(SKILLS_DIR, ...segments), "utf8");

const CI_CHECK_TO_COMMAND = read("_shared", "ci-check-to-command.md");
const FAILURE_MODE_HANDLING = read("_shared", "failure-mode-handling.md");
const FIX_CI = read("do", "fix-ci.md");
const E2E_REPAIR = read("do", "e2e-repair.md");
const BLOCKED_REMINDER = read("muggle-pr-followup", "output-templates", "blocked-reminder.md");
const STATE_SCHEMAS = read("muggle-pr-followup", "state-schemas.md");

const walkthroughStep = sectionBody(FIX_CI, /^### Step 2\.5 — Red E2E walkthrough check.*$/m);
const escalateStep = sectionBody(FIX_CI, /^### Step 6 — Escalate.*$/m);
const dispositionStep = sectionBody(E2E_REPAIR, /^## Step 2: Disposition.*$/m);
const decisionStep = sectionBody(E2E_REPAIR, /^## Step 4: The user decision.*$/m);
const closeLoopStep = sectionBody(E2E_REPAIR, /^## Step 5: Close the loop.*$/m);
const walkthroughRow = CI_CHECK_TO_COMMAND.split("\n").find((line) => line.startsWith("| `muggle-walkthrough`")) ?? "";

describe("red walkthrough routing", () => {
  it("keeps muggle-walkthrough in scope and out of the E2E-in-CI escalation row", () => {
    expect(walkthroughRow).toMatch(/In scope/);
    expect(CI_CHECK_TO_COMMAND).toMatch(/E2E suite run inside CI other than `muggle-walkthrough`/);
  });

  it("splits a failed walkthrough from an empty one by the check summary", () => {
    expect(walkthroughRow).toMatch(/"did not pass"/);
    expect(walkthroughRow).toMatch(/"still empty"/);
    expect(walkthroughRow).toMatch(/Never a code fix/);
    expect(walkthroughStep).toMatch(/\*\*did not pass\*\*/);
    expect(walkthroughStep).toMatch(/\*\*still empty\*\*/);
  });

  it("waits on this PR's own queued run instead of racing the walkthrough builder", () => {
    expect(walkthroughStep).toMatch(/E2E dispatch: queued/);
    expect(walkthroughStep).toMatch(/Never run a second suite/);
  });

  it("feeds failed cases into the E2E repair loop", () => {
    expect(walkthroughStep).toMatch(/e2e-repair\.md/);
    expect(E2E_REPAIR).toMatch(/Entered from fix-ci, the failing cases come from the red check/);
  });

  it("never lets a NO_APP_LOGIC_CHANGE skip clear a failed run", () => {
    expect(walkthroughRow).toMatch(/clears none of its failures/);
    expect(walkthroughStep).toMatch(/the skip clears nothing/);
  });
});

describe("unrepairable walkthrough cases", () => {
  it("escalates them as a decision request carrying cases, buckets, and options", () => {
    expect(walkthroughStep).toMatch(/never a picker, never a waiver/);
    expect(escalateStep).toMatch(/E2E decision request/);
    expect(escalateStep).toMatch(/repair with direction, feedback and rerun, waive, stop/);
    expect(escalateStep).toMatch(/last_seen\.e2e_decision/);
  });

  it("gives the watcher's blocked reminder the decision instead of the generic CI line", () => {
    expect(STATE_SCHEMAS).toMatch(/`e2e_decision`:/);
    expect(BLOCKED_REMINDER).toMatch(/`ci_escalated` with `last_seen\.e2e_decision` on this head/);
    expect(BLOCKED_REMINDER).toMatch(/repair <direction> \| feedback\+rerun \| waive \| stop/);
  });

  it("never waives on the user's behalf", () => {
    expect(decisionStep).not.toMatch(/automatic waive/);
    expect(decisionStep).toMatch(/open decision\*\*, never a waiver/);
    expect(closeLoopStep).not.toMatch(/waive automatically/);
    expect(E2E_REPAIR).toMatch(/`decision-pending`/);
  });
});

describe("test-precondition bucket", () => {
  it("is defined with the other failure buckets", () => {
    expect(FAILURE_MODE_HANDLING).toMatch(/\| \*\*test-precondition\*\* \| The product behaves correctly/);
    expect(FAILURE_MODE_HANDLING).toMatch(/"test-precondition"/);
  });

  it("repairs the test, never the product, and needs a named defect", () => {
    expect(dispositionStep).toMatch(/\| `test-precondition` \(either\) \| `repair-test` \|/);
    expect(dispositionStep).toMatch(/A `repair-test` disposition requires one too/);
    expect(E2E_REPAIR).toMatch(/`repair-test` changes the test case, never product code/);
  });
});
