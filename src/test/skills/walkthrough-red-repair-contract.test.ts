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
const BLOCKED_TICK = read("muggle-pr-followup", "blocked-tick.md");
const REPORT_ASSEMBLY = read("muggle-pr-visual-walkthrough", "e2e-report-assembly.md");
const WALKTHROUGH_SKILL = read("muggle-pr-visual-walkthrough", "SKILL.md");
const WALKTHROUGH_BUILDER = fs.readFileSync(path.resolve(SKILLS_DIR, "../agents/visual-walkthrough-builder.md"), "utf8");
const STATE_SCHEMAS = read("muggle-pr-followup", "state-schemas.md");

const walkthroughStep = sectionBody(FIX_CI, /^### Step 2\.5 — Red E2E walkthrough check.*$/m);
const escalateStep = sectionBody(FIX_CI, /^### Step 6 — Escalate.*$/m);
const dispositionStep = sectionBody(E2E_REPAIR, /^## Step 2: Disposition.*$/m);
const decisionStep = sectionBody(E2E_REPAIR, /^## Step 4: The user decision.*$/m);
const closeLoopStep = sectionBody(E2E_REPAIR, /^## Step 5: Close the loop.*$/m);
const unrepairedCases = sectionBody(E2E_REPAIR, /^## Unrepaired cases.*$/m);
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

// The #570 incident: an outage stopped the repair, the reason lived only in the session's state.md, the walkthrough
// still just listed failures, and nothing re-attempted the repair once the outage ended.
describe("walkthrough cases left unrepaired", () => {
  it("allows only three reasons not to repair", () => {
    expect(unrepairedCases).toMatch(/repaired by default/);
    for (const kind of ["temporary-blocker", "owner-decision", "budget-spent"]) {
      expect(unrepairedCases).toContain(`\`${kind}\``);
    }
    expect(unrepairedCases).toMatch(/Anything else is not a reason: repair the case/);
  });

  it("states why on the PR's walkthrough, never only in session state", () => {
    expect(unrepairedCases).toMatch(/`repairHold`/);
    expect(unrepairedCases).toMatch(/A `state\.md` entry or a session message is not enough/);
    expect(escalateStep).toMatch(/\*\*Settle the walkthrough\*\*/);
    expect(REPORT_ASSEMBLY).toMatch(/`repairHold`/);
  });

  it("waits out a temporary blocker and retries without a prompt", () => {
    expect(dispositionStep).toMatch(/\| `infra` \(either\) \| `wait` \|/);
    expect(dispositionStep).toMatch(/takes `wait` like `infra`, whatever its bucket/);
    expect(unrepairedCases).toMatch(/never becomes a decision request/);
    expect(unrepairedCases).toMatch(/last_seen\.ci_wait/);
    expect(escalateStep).toMatch(/write `last_seen\.ci_wait`/);
    expect(FIX_CI).toMatch(/\*\*A due repair wait\.\*\*/);
    expect(STATE_SCHEMAS).toMatch(/`ci_wait`:/);
    expect(STATE_SCHEMAS).toMatch(/`CI_RETRY_AT`/);
    expect(BLOCKED_TICK).toMatch(/treat the tick as \*\*Changed\*\* whatever the fingerprint says/);
    expect(BLOCKED_REMINDER).toMatch(/`ci_escalated` with `last_seen\.ci_wait` on this head/);
  });
});

// #570 showed a stale 0/6 for hours while repair commits were pushed and a rerun was pending.
describe("cycle progress on the walkthrough", () => {
  const cycleProgress = sectionBody(WALKTHROUGH_SKILL, /^## Cycle progress.*$/m);

  it("posts each job's status in the background, editing the existing comment", () => {
    expect(cycleProgress).toMatch(/\*\*in the background\*\*/);
    expect(cycleProgress).toMatch(/never posts a new one/);
    expect(cycleProgress).toMatch(/The cycle never waits on it/);
    expect(WALKTHROUGH_BUILDER).toMatch(/\*\*Mode D \(`status`\)\*\*/);
    expect(WALKTHROUGH_BUILDER).toMatch(/<!-- muggle-pr-walkthrough-cycle -->/);
  });

  it("is referenced from the repair cycle, not restated", () => {
    for (const caller of [FIX_CI, E2E_REPAIR]) {
      expect(caller).toMatch(/SKILL\.md#cycle-progress/);
    }
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
