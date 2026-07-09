/**
 * Static wiring lint for the muggle-pr-followup blocked-reminder state, the
 * durable cron-id lifecycle, and the guaranteed watcher respawn. Guards these
 * against silent drift — a schema field dropped from a doc, a procedure step
 * deleted, a log-line template removed, the blocked-path cadence drifting off
 * its 5m backoff, or a /muggle-do exit path dropping the respawn. It reads the
 * prose contract; it does not execute the watcher (that judgment lives in the
 * LLM at runtime).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILL_DIR = path.join(
  REPO_ROOT,
  "plugin",
  "skills",
  "muggle-pr-followup",
);
const SHARED_DIR = path.join(REPO_ROOT, "plugin", "skills", "_shared");
const DO_DIR = path.join(REPO_ROOT, "plugin", "skills", "do");

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(...segments), "utf8");
}

describe("pr-followup blocked-reminder wiring", () => {
  const contract = read(SKILL_DIR, "contract.md");
  const stateSchemas = read(SKILL_DIR, "state-schemas.md");
  const watcherLog = read(SKILL_DIR, "output-templates", "watcher-log.md");
  const blockedTick = read(SKILL_DIR, "blocked-tick.md");
  const blockedReminder = read(
    SKILL_DIR,
    "output-templates",
    "blocked-reminder.md",
  );
  const tickEvent = read(SHARED_DIR, "telemetry-events", "pr-followup-tick.md");

  it("state-schemas documents the blocked field with its fingerprint components", () => {
    expect(stateSchemas).toMatch(/"blocked"/);
    for (const component of ["head_sha", "latest_review_id", "ci_digest"]) {
      expect(
        stateSchemas.includes(component),
        `state-schemas.md blocked fingerprint is missing ${component}`,
      ).toBe(true);
    }
  });

  it("contract's blocked-tick gate references the extracted blocked-tick.md", () => {
    expect(contract).toMatch(/Blocked-tick gate/i);
    expect(contract).toMatch(/blocked-tick\.md/);
  });

  it("blocked-tick.md carries the fingerprint + remind detail extracted from contract", () => {
    expect(fs.existsSync(path.join(SKILL_DIR, "blocked-tick.md"))).toBe(true);
    for (const component of ["head_sha", "latest_review_id", "ci_digest"]) {
      expect(
        blockedTick.includes(component),
        `blocked-tick.md fingerprint is missing ${component}`,
      ).toBe(true);
    }
    expect(blockedTick).toMatch(/blocked-reminder\.md/);
    expect(blockedTick).toMatch(/Remind or resume/i);
  });

  it("contract's idle step reminds on every durable human-block reason", () => {
    for (const reason of [
      "conflict_escalated",
      "ci_escalated",
      "reviews_escalated",
    ]) {
      expect(
        contract.includes(reason),
        `contract.md idle step does not cover blocked reason ${reason}`,
      ).toBe(true);
    }
  });

  it("blocked watcher backs off to the 5m cadence — slower but never stopped", () => {
    // #315 review: slow the blocked poll to 5m to save cost, keep reminding (never stop).
    for (const doc of [contract, blockedTick]) {
      expect(doc).toMatch(/5m/); // the blocked cadence
      expect(doc).not.toMatch(/parked/i); // not the rejected park design
      expect(doc).not.toMatch(/un-?park/i);
      expect(doc).not.toMatch(/30m/); // 5m, not the old slow interval
    }
    // The backoff is a real cron swap (cancel-then-create), and the poll never fully stops.
    expect(blockedTick).toMatch(/CronCreate/);
    expect(blockedTick).toMatch(/\* \* \* \* \*/); // restores the 1m cron on resume
    expect(blockedTick).toMatch(/never stop/i);
  });

  it("blocked-reminder template is one line with a per-reason traceback reference", () => {
    expect(
      fs.existsSync(
        path.join(SKILL_DIR, "output-templates", "blocked-reminder.md"),
      ),
    ).toBe(true);
    for (const reason of [
      "conflict_escalated",
      "ci_escalated",
      "reviews_escalated",
    ]) {
      expect(
        blockedReminder.includes(reason),
        `blocked-reminder.md is missing wording for ${reason}`,
      ).toBe(true);
    }
    expect(blockedReminder).toMatch(/awaiting you/);
  });

  it("watcher-log carries the blocked line shape, not parked/unparked", () => {
    expect(watcherLog).toMatch(/blocked reason=/);
    expect(watcherLog).not.toMatch(/unparked/);
  });

  it("tick telemetry declares blocked, reminded, and the cadence interval", () => {
    expect(tickEvent).toMatch(/"blocked"/);
    expect(tickEvent).toMatch(/"reminded"/);
    expect(tickEvent).toMatch(/"interval"/);
    expect(tickEvent).toMatch(/5m/); // interval field documents the blocked backoff
    expect(tickEvent).not.toMatch(/"parked"/);
  });
});

describe("pr-followup cron-id lifecycle wiring", () => {
  const contract = read(SKILL_DIR, "contract.md");
  const stateSchemas = read(SKILL_DIR, "state-schemas.md");
  const cancelCron = read(SKILL_DIR, "cancel-cron.md");
  const reconcile = read(SKILL_DIR, "reconcile.md");
  const bootstrap = read(SKILL_DIR, "bootstrap.md");

  it("record-cron-id.md exists and is referenced by the tick procedure", () => {
    expect(fs.existsSync(path.join(SKILL_DIR, "record-cron-id.md"))).toBe(true);
    expect(contract).toMatch(/record-cron-id\.md/);
  });

  it("state-schemas documents cron.json with a cron_id field", () => {
    expect(stateSchemas).toMatch(/##\s+`cron\.json`/);
    expect(stateSchemas).toMatch(/cron_id/);
  });

  it("bootstrap seeds cron.json", () => {
    expect(bootstrap).toMatch(/cron\.json/);
  });

  it("cancel-cron deletes by the recorded id before falling back to CronList", () => {
    expect(cancelCron).toMatch(/cron_id/);
    expect(cancelCron).toMatch(/CronList/);
    // The recorded-id lookup must be documented ahead of the CronList fallback.
    expect(cancelCron.indexOf("cron_id")).toBeLessThan(
      cancelCron.indexOf("fallback"),
    );
  });

  it("reconcile sweeps orphaned crons whose slot is gone or terminal", () => {
    expect(reconcile).toMatch(/orphan/i);
    expect(reconcile).toMatch(/CronDelete/);
    expect(reconcile).toMatch(/CronList/);
  });
});

describe("pr-followup watcher-respawn robustness wiring", () => {
  const reconcile = read(SKILL_DIR, "reconcile.md");
  const respawnWatcher = read(DO_DIR, "respawn-watcher.md");
  const addressReviews = read(DO_DIR, "address-reviews.md");
  const fixCi = read(DO_DIR, "fix-ci.md");
  const resolveConflicts = read(DO_DIR, "resolve-conflicts.md");

  it("respawn-watcher.md exists as the shared, guaranteed restart", () => {
    expect(fs.existsSync(path.join(DO_DIR, "respawn-watcher.md"))).toBe(true);
    expect(respawnWatcher).toMatch(/\/loop 1m \/muggle:muggle-pr-followup/);
    // The whole point: respawn on every open-PR exit, terminal PR is the only skip.
    expect(respawnWatcher).toMatch(/every.{0,40}exit/i);
    expect(respawnWatcher).toMatch(/merged or closed/i);
  });

  it("every watcher-dispatched mode routes its respawn through the shared helper", () => {
    for (const [name, doc] of [
      ["address-reviews", addressReviews],
      ["fix-ci", fixCi],
      ["resolve-conflicts", resolveConflicts],
    ] as const) {
      expect(
        doc.includes("respawn-watcher.md"),
        `${name} does not reference the shared respawn helper`,
      ).toBe(true);
    }
  });

  it("the two closed holes escalate AND respawn (never a silent stop)", () => {
    // address-reviews Step 0 rebase-escalation must reach the respawn step.
    const step0 = addressReviews.slice(
      addressReviews.indexOf("Step 0 — Track"),
      addressReviews.indexOf("Step 1 — Assemble"),
    );
    expect(step0).toMatch(/respawn/i);
    // fix-ci Step 6 escalation must respawn, not just stop looping on the SHA.
    // Anchor on the heading text — "Step 6" is also cross-referenced from earlier steps.
    const escalate = fixCi.slice(
      fixCi.indexOf("Escalate (budget"),
      fixCi.indexOf("Step 7 — Telemetry"),
    );
    expect(escalate).toMatch(/respawn-watcher\.md/);
  });

  it("reconcile re-arms an open slot whose watcher stopped silently", () => {
    expect(reconcile).toMatch(/re-arm/i);
    expect(reconcile).toMatch(/silent/i);
    expect(reconcile).toMatch(/CronCreate/);
    // Guarded by a staleness window so a live (CronList-blind) cron is never doubled.
    expect(reconcile).toMatch(/followup\.log/);
  });
});
