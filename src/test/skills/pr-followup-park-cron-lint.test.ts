/**
 * Static wiring lint for the muggle-pr-followup park/backoff state and the
 * durable cron-id lifecycle. Guards the two features against silent drift —
 * a schema field dropped from a doc, a procedure step deleted, a log-line
 * template removed. It reads the prose contract; it does not execute the
 * watcher (that judgment lives in the LLM at runtime).
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

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(...segments), "utf8");
}

describe("pr-followup park/backoff wiring", () => {
  const contract = read(SKILL_DIR, "contract.md");
  const stateSchemas = read(SKILL_DIR, "state-schemas.md");
  const watcherLog = read(SKILL_DIR, "output-templates", "watcher-log.md");
  const tickEvent = read(
    SHARED_DIR,
    "telemetry-events",
    "pr-followup-tick.md",
  );

  it("state-schemas documents the park field with its fingerprint components", () => {
    expect(stateSchemas).toMatch(/"park"/);
    for (const component of ["head_sha", "latest_review_id", "ci_digest"]) {
      expect(
        stateSchemas.includes(component),
        `state-schemas.md park fingerprint is missing ${component}`,
      ).toBe(true);
    }
  });

  it("contract has a park-resume gate that recomputes and compares the fingerprint", () => {
    expect(contract).toMatch(/Park-resume gate/i);
    expect(contract).toMatch(/fingerprint/i);
    expect(contract).toMatch(/un-?park/i);
  });

  it("contract's idle step parks on every durable human-block reason", () => {
    for (const reason of [
      "conflict_escalated",
      "ci_escalated",
      "reviews_escalated",
    ]) {
      expect(
        contract.includes(reason),
        `contract.md idle step does not cover park reason ${reason}`,
      ).toBe(true);
    }
  });

  it("contract swaps cadence to a defined parked interval, not a bare 1m re-arm", () => {
    expect(contract).toMatch(/parked interval/i);
    expect(contract).toMatch(/30m/);
  });

  it("watcher-log carries parked and unparked line shapes", () => {
    expect(watcherLog).toMatch(/parked/);
    expect(watcherLog).toMatch(/unparked/);
  });

  it("tick telemetry event declares the parked field", () => {
    expect(tickEvent).toMatch(/"parked"/);
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
