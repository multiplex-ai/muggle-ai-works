/**
 * Static lint for loop-first recovery.
 *
 * The failure this suite pins: after a compaction killed the session watchers,
 * the per-minute recovery crons became the primary pollers — six slots burned a
 * full model turn per tick, every minute, for hours, on PRs that never changed.
 * Two doc gaps allowed it: reconcile re-armed dead watchers with a recurring
 * cron, and the tick contract had no step handing a cron-delivered tick back to
 * the token-free loop. Prose is the implementation here, so these assert the
 * procedure still says the load-bearing thing; they do NOT catch an agent that
 * ignores the doc.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const WATCHER_DIR = path.join(
  REPO_ROOT,
  "plugin",
  "skills",
  "muggle-pr-followup",
);

function read(name: string): string {
  return fs.readFileSync(path.join(WATCHER_DIR, name), "utf8");
}

/** Slice a markdown heading's body so an assertion can't match text from a different step. */
function section(md: string, startHeading: RegExp, endHeading: RegExp): string {
  const start = md.search(startHeading);
  if (start === -1) return "";
  const rest = md.slice(start);
  const end = rest.slice(1).search(endHeading);
  return end === -1 ? rest : rest.slice(0, end + 1);
}

const contract = read("contract.md");
const reconcile = read("reconcile.md");
const skill = read("SKILL.md");

const step75 = section(contract, /^### Step 7\.5\b/m, /^## Output\b/m);
const step7 = section(contract, /^### Step 7\b/m, /^### Step 7\.5\b/m);
const step25 = section(contract, /^### Step 2\.5\b/m, /^### Step 3\b/m);
const rearm = section(reconcile, /^### Step 3\.6\b/m, /^### Step 4\b/m);

describe("parser sanity: refuse to pass vacuously", () => {
  it("every section this suite reads was actually found", () => {
    const missing = Object.entries({ step75, step7, step25, rearm })
      .filter(([, body]) => body.trim().length === 0)
      .map(([name]) => name);
    expect(
      missing,
      `headings moved or were renamed, so these assertions would pass against empty strings: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

describe("contract Step 7.5 — every idle tick leaves one loop polling", () => {
  // A loop exits on every report, and a heartbeat it touched a minute ago reads
  // fresh after it is gone, so only the lease says whether anything still polls.
  it("gates on the watch.pid lease", () => {
    expect(step75).toMatch(/watch\.pid/);
  });

  it("re-arms a dead loop per arm-watcher and cancels a delivering cron", () => {
    expect(step75).toMatch(/arm-watcher\.md/);
    expect(step75).toMatch(/cancel-cron\.md/);
  });

  // A cron-delivered tick carries no flag, so the cron recorded for the slot is
  // the only observable trigger; keyed on how the tick arrived, the cancel never fired.
  it("cancels the slot's recorded cron after the arm, whether or not a loop is alive", () => {
    expect(step75).toMatch(/recovery cron[\s\S]*Step 0 recorded one[\s\S]*cancel it per/);
    expect(step75).toMatch(/after the arm/);
  });

  it("names the cost that makes this load-bearing: cron fires are model turns, the loop is token-free", () => {
    expect(step75).toMatch(/model turn/);
    expect(step75).toMatch(/token-free/);
  });

  it("leaves re-arming after a dispatch to the cycle's settle", () => {
    expect(step75).toMatch(/dispatching tick skips it/);
  });

  it("both Step 7 idle branches and a Step 2.5 held block route through it", () => {
    const exits = step7.match(/[Ee]xit through Step 7\.5/g) ?? [];
    expect(exits.length).toBeGreaterThanOrEqual(2);
    expect(step25).toMatch(/Step 7\.5/);
  });
});

describe("reconcile Step 3.6 — re-arm is loop-first, never a recurring cron", () => {
  it("re-arms per arm-watcher (drain, watermark, background loop)", () => {
    expect(rearm).toMatch(/arm-watcher\.md/);
    expect(rearm).toMatch(/background loop/);
  });

  it("never instructs CronCreate — the regression that turned recovery crons into primary pollers", () => {
    expect(rearm).not.toMatch(/CronCreate/);
    expect(rearm).toMatch(/[Nn]ever re-arm with a recurring cron/);
  });
});

describe("SKILL.md — crons deliver recovery ticks, never the ongoing cadence", () => {
  it("routes the reader to the Step 7.5 hand-back", () => {
    expect(skill).toMatch(/Step 7\.5/);
    expect(skill).toMatch(/loop-first/);
  });
});
