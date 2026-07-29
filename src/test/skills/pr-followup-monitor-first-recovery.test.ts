/**
 * Static lint for monitor-first recovery.
 *
 * The failure this suite pins: after a compaction killed the session monitors,
 * the per-minute recovery crons became the primary pollers — six slots burned a
 * full model turn per tick, every minute, for hours, on PRs that never changed.
 * Two doc gaps allowed it: reconcile re-armed dead watchers with a recurring
 * cron, and the tick contract had no step handing a cron-delivered tick back to
 * the token-free monitor. Prose is the implementation here, so these assert the
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

describe("contract Step 7.5 — a cron-delivered tick hands back to the monitor", () => {
  it("gates on the watch-heartbeat liveness beacon", () => {
    expect(step75).toMatch(/watch-heartbeat/);
  });

  it("re-arms the dead monitor per arm-watcher and cancels the cron", () => {
    expect(step75).toMatch(/arm-watcher\.md/);
    expect(step75).toMatch(/cancel-cron\.md/);
  });

  it("cancels a duplicate cron even when the monitor is alive", () => {
    expect(step75).toMatch(/[Ff]resh.*duplicate poller/s);
  });

  it("names the cost that makes this load-bearing: cron fires are model turns, the monitor is token-free", () => {
    expect(step75).toMatch(/model turn/);
    expect(step75).toMatch(/token-free/);
  });

  it("exempts a monitor wake — it already owns the cadence", () => {
    expect(step75).toMatch(/monitor wake/i);
  });

  it("both Step 7 idle branches and a Step 2.5 held block route through it", () => {
    const exits = step7.match(/[Ee]xit through Step 7\.5/g) ?? [];
    expect(exits.length).toBeGreaterThanOrEqual(2);
    expect(step25).toMatch(/Step 7\.5/);
  });
});

describe("reconcile Step 3.6 — re-arm is monitor-first, never a recurring cron", () => {
  it("re-arms per arm-watcher (drain, watermark, persistent monitor)", () => {
    expect(rearm).toMatch(/arm-watcher\.md/);
    expect(rearm).toMatch(/persistent monitor/);
  });

  it("never instructs CronCreate — the regression that turned recovery crons into primary pollers", () => {
    expect(rearm).not.toMatch(/CronCreate/);
    expect(rearm).toMatch(/[Nn]ever re-arm with a recurring cron/);
  });
});

describe("SKILL.md — crons deliver recovery ticks, never the ongoing cadence", () => {
  it("routes the reader to the Step 7.5 hand-back", () => {
    expect(skill).toMatch(/Step 7\.5/);
    expect(skill).toMatch(/monitor-first/);
  });
});
