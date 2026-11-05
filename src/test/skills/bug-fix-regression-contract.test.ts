/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins what muggle-do does for a bug fix and what every cycle shows before it
 * ends. A bug fix writes its regression unit test first and gets a case of its
 * own, because a case that passed while the bug was live proves nothing. The
 * audit trail then shows the tests involved, their results and links to the
 * proof: it reports, and gates nothing.
 *
 * Prose is the implementation here. These assertions do NOT catch an agent that
 * reads the contract and ignores it; the agent-gate eval's muggle-do.e2e-scope
 * suite does.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { sectionBody } from "./helpers/markdown-sections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, "../../../plugin/skills");
const DO_DIR = path.join(SKILLS_DIR, "do");

const read = (...segments: string[]): string => fs.readFileSync(path.join(...segments), "utf8");

const REQUIREMENTS = read(DO_DIR, "requirements.md");
const BUILD = read(DO_DIR, "build.md");
const IMPACT_ANALYSIS = read(DO_DIR, "impact-analysis.md");
const CYCLE_SIZE = read(DO_DIR, "cycle-size.md");
const FORWARD = read(DO_DIR, "open-prs", "forward.md");
const AUDIT_TRAIL = read(DO_DIR, "audit-trail.md");
const NEXT_STEP = read(DO_DIR, "next-step.md");
const CLEANUP = read(DO_DIR, "cleanup.md");
const RESPAWN_WATCHER = read(DO_DIR, "respawn-watcher.md");
const MUGGLE_DO = read(SKILLS_DIR, "muggle-do", "SKILL.md");

const definitionOfDone = sectionBody(MUGGLE_DO, /^### Definition of Done.*$/m);
const planNewCases = IMPACT_ANALYSIS.slice(IMPACT_ANALYSIS.indexOf("6. **Plan the new cases.**"), IMPACT_ANALYSIS.indexOf("7. **Plan the deliverable checks.**"));
const stageReport = sectionBody(FORWARD, /^## Stage 7 — report on the PR$/m);
const forwardOutput = sectionBody(FORWARD, /^## Output$/m);
const nextStepProcedure = sectionBody(NEXT_STEP, /^## Procedure$/m);
const auditSources = sectionBody(AUDIT_TRAIL, /^## Sources$/m);
const auditShape = sectionBody(AUDIT_TRAIL, /^## Shape$/m);
const auditRules = sectionBody(AUDIT_TRAIL, /^## Rules$/m);
const recurringRunStep = stageReport.slice(stageReport.indexOf("**Recurring run:**"));

describe("parser sanity: refuse to pass vacuously", () => {
  it("finds every section under test", () => {
    for (const [name, body] of Object.entries({
      definitionOfDone: definitionOfDone,
      planNewCases: planNewCases,
      stageReport: stageReport,
      forwardOutput: forwardOutput,
      nextStepProcedure: nextStepProcedure,
      auditSources: auditSources,
      auditShape: auditShape,
      auditRules: auditRules,
    })) {
      expect(body.trim().length, name).toBeGreaterThan(0);
    }
    expect(recurringRunStep.length).toBeGreaterThan("**Recurring run:**".length);
  });
});

describe("bug-fix regression contract", () => {
  it("records the change type and a one-line regression criterion in requirements", () => {
    expect(REQUIREMENTS).toContain("**Change type:** bug fix | other");
    expect(REQUIREMENTS).toContain("**Regression criterion:** [<category>]");
  });

  it("writes the regression test before the fix and records it failing, then passing", () => {
    const proveFirst = BUILD.indexOf("**Prove a bug fix first.**");
    expect(proveFirst).toBeGreaterThan(-1);
    expect(proveFirst).toBeLessThan(BUILD.indexOf("**Apply the change**"));
    expect(BUILD).toContain("`failed before, passed after`");
  });

  it("refuses to map a bug onto a case that never caught it", () => {
    expect(planNewCases).toMatch(/regression criterion is uncovered unless an existing case's recorded run shows it failing/);
    expect(planNewCases).toMatch(/passed while the bug was live never caught it/);
    expect(planNewCases).toContain("gets a new test case");
  });
});

describe("audit trail", () => {
  it("reports and gates nothing", () => {
    expect(AUDIT_TRAIL).toMatch(/reports and gates nothing/);
    expect(AUDIT_TRAIL).toMatch(/never a reason to stop, retry, or ask/);
    expect(definitionOfDone).not.toMatch(/audit trail|regression/i);
  });

  it("shows unit tests by name and file path with results", () => {
    expect(auditSources).toMatch(/\*\*Unit tests\*\* — .*name, file path and result/);
    expect(auditShape).toMatch(/PASS {2}.* — src\/signup\/signup\.test\.ts/);
  });

  it("shows E2E tests with results", () => {
    expect(auditSources).toMatch(/\*\*E2E tests\*\* — .*title, result and `viewUrl`/);
    expect(auditSources).toMatch(/skipped run shows its skip code and detail/);
  });

  it("links the evidence instead of listing ids", () => {
    expect(auditSources).toMatch(/\*\*Evidence\*\* — the PR's walkthrough comment, then the `viewUrl` of each run/);
    expect(auditRules).toMatch(/Links, not ids/);
    expect(auditShape).toMatch(/Walkthrough: https:/);
  });

  it("says what is missing instead of hiding it", () => {
    expect(auditRules).toMatch(/Every section prints/);
    expect(auditRules).toMatch(/`none — <reason>`/);
    expect(auditShape).toContain("Missing:");
    expect(auditRules).toMatch(/`not run`, not a pass/);
  });

  it("prints at the normal end of a cycle, not only after merge", () => {
    expect(forwardOutput).toMatch(/closing message opens with the \[audit trail\]\(\.\.\/audit-trail\.md\), on every exit, a cycle that opened no PR included/);
    expect(RESPAWN_WATCHER).toMatch(/closing message is the text after the watch is armed, and it opens with the \[audit trail\]\(audit-trail\.md\)/);
  });

  it("goes in the closing message in full, never earlier in the turn or summarized", () => {
    expect(AUDIT_TRAIL).toMatch(/block printed earlier in the turn, or summarized, does not count/);
  });

  it("prints as a fenced block with fixed headings, never a prose recap", () => {
    expect(auditRules).toMatch(/fenced block with exactly these headings: `Audit trail — <pr>`, `Unit tests`, `E2E tests`, `Evidence`, `Missing:`/);
    expect(auditRules).toMatch(/prose recap .* does not count/);
  });

  it("stays in the skill the agent keeps in context, outside the gate", () => {
    const skillSection = sectionBody(MUGGLE_DO, /^### Audit trail$/m);
    expect(skillSection).toMatch(/closing message opens with the fenced block/);
    expect(skillSection).toMatch(/reports and gates nothing/);
    expect(skillSection).toMatch(/the watcher arms first/);
  });

  it("follows the watcher arm instead of ending the cycle", () => {
    expect(RESPAWN_WATCHER).toMatch(/Arm before you write anything closing/);
    expect(RESPAWN_WATCHER).toMatch(/Printing the block does not end the cycle/);
    expect(AUDIT_TRAIL.split("\n")[2]).toMatch(/^\*\*Arm first\.\*\*.*written after the arm, never instead of it/);
  });

  it("prints before the ending selector", () => {
    const auditIndex = nextStepProcedure.indexOf("[audit trail](audit-trail.md)");
    expect(auditIndex).toBeGreaterThan(-1);
    expect(auditIndex).toBeLessThan(nextStepProcedure.indexOf("[selector](#selector)"));
  });

  it("survives teardown in the terminal record", () => {
    expect(sectionBody(CLEANUP, /^## Terminal record$/m)).toMatch(/^- `auditTrail` — .*while they still exist/m);
  });
});

describe("recurring run offer", () => {
  it("looks in the repo, since no tool reads a project's schedule", () => {
    expect(recurringRunStep).toContain("`schedule:` trigger in `.github/workflows/`");
    expect(recurringRunStep).toContain("`.gitlab-ci.yml`");
  });

  it("offers the schedule and the CI check without blocking an unattended cycle", () => {
    expect(recurringRunStep).toContain("`muggle-remote-recommend-schedule`");
    expect(recurringRunStep).toContain("`/muggle-ci-install`");
    expect(recurringRunStep).toMatch(/nothing here asks, installs, or waits/);
    expect(recurringRunStep).not.toContain("AskUserQuestion");
  });

  it("respects a declined CI check", () => {
    expect(recurringRunStep).toContain("`autoInstallCiWorkflow`");
    expect(recurringRunStep).toContain("is not `never`");
    expect(recurringRunStep).toContain("`CI check: skip`");
  });

  it("never presents the PR check as the recurring run", () => {
    expect(recurringRunStep).toMatch(/PR walkthrough check replays nothing/);
  });

  it("runs before the handoff, so arming stays the stage's last action", () => {
    expect(FORWARD.indexOf("**Recurring run:** bug fixes only")).toBeLessThan(FORWARD.indexOf("## Stage 8 handoff"));
  });
});

describe("watcher cycles", () => {
  it("owe no new regression test or case", () => {
    expect(CYCLE_SIZE).toMatch(/follow-up on a bug-fix PR is sized by the same rule and owes no new regression test or case/);
    expect(BUILD).toMatch(/re-entries below owe no new regression test/);
    expect(planNewCases).toMatch(/watcher cycle plans no second case/);
  });
});

describe("customer-facing copy", () => {
  it("names no internal project or fixture", () => {
    for (const doc of [AUDIT_TRAIL, planNewCases, recurringRunStep]) {
      expect(doc).not.toMatch(/11eedc6e|301f55a9|5365f324|mailosaur|muggle-ai\.com/);
    }
  });
});
