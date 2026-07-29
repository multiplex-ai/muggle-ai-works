/**
 * Static lint for the stop mode and the stopped-slot absorb.
 *
 * The failure this suite pins: crons whose handles a compaction severed cannot
 * be deleted from any tool surface — they fire until their host session dies.
 * The owner spent an evening killing monitors, crons, processes, and a daemon
 * by hand, and the unreachable orphans still fired. The design answer is not a
 * better delete (none exists) but (a) a one-command teardown that marks slots
 * `.stopped`, and (b) an entry-gate absorb that makes any survivor inert.
 * Prose is the implementation here; these assert the procedure still says the
 * load-bearing thing, they do NOT catch an agent that ignores the doc.
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

const skill = read("SKILL.md");
const stop = read("stop.md");
const contract = read("contract.md");
const reconcile = read("reconcile.md");
const bootstrap = read("bootstrap.md");

describe("stop mode — one command tears down every substrate", () => {
  it("is routed from SKILL.md", () => {
    expect(skill).toMatch(/\| `stop` \(optional `<slug>`\)/);
    expect(skill).toMatch(/stop\.md/);
  });

  it("stops the monitor including Windows grandchildren that outlive TaskStop", () => {
    expect(stop).toMatch(/TaskStop/);
    expect(stop).toMatch(/grandchild|outlive/i);
  });

  it("cancels the cron recorded-id first and admits orphans honestly", () => {
    expect(stop).toMatch(/cancel-cron\.md/);
    expect(stop).toMatch(/orphan/i);
  });

  it("renames the slot to .stopped — the load-bearing act every recovery path keys on", () => {
    expect(stop).toMatch(/<slug>\.stopped/);
  });

  it("stop-everything writes the global kill file; only bootstrap overrides it", () => {
    expect(stop).toMatch(/polling\.disabled/);
    expect(stop).toMatch(/[Bb]ootstrap.*(ignores|overrides|removes)/s);
  });

  it("stopping is not finalizing — resumable, no result.md", () => {
    expect(stop).toMatch(/not finalizing/i);
    expect(stop).toMatch(/renam\w+ `?<slug>`?\.stopped`? back/i);
  });
});

describe("stopped-slot absorb — a surviving orphan is inert, never a poller", () => {
  it("contract Step 0 absorbs before any fetch or state write", () => {
    const step0 = contract.slice(
      contract.indexOf("### Step 0"),
      contract.indexOf("### Step 1"),
    );
    expect(step0).toMatch(/\.stopped/);
    expect(step0).toMatch(/polling\.disabled/);
    expect(step0).toMatch(/no fetch, no state write/i);
  });

  it("SKILL.md routes a stopped slug to the absorb, not the missing-session error", () => {
    const absorbRow = skill
      .split("\n")
      .find((l) => l.includes("`<slug>.stopped`"));
    expect(absorbRow).toBeDefined();
    expect(absorbRow).toMatch(/absorb/i);
  });
});

describe("no recovery path revives a stopped slot", () => {
  it("reconcile enumeration skips *.stopped dirs — a .stopped dir still holds prs.json", () => {
    const step1 = reconcile.slice(
      reconcile.indexOf("### Step 1"),
      reconcile.indexOf("### Step 2"),
    );
    expect(step1).toMatch(/\.stopped/);
  });

  it("reconcile re-arm refuses while the global kill file exists", () => {
    const rearm = reconcile.slice(
      reconcile.indexOf("### Step 3.6"),
      reconcile.indexOf("### Step 4"),
    );
    expect(rearm).toMatch(/polling\.disabled/);
  });

  it("bootstrap clears the kill file — an explicit URL is consent to watch again", () => {
    expect(bootstrap).toMatch(/polling\.disabled/);
  });
});
