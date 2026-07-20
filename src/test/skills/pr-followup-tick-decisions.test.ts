/**
 * Static lint for the muggle-pr-followup tick's decision branches.
 *
 * The watcher decides, every minute, whether to dispatch or idle. Each branch
 * below encodes a failure the loop already hit in production — a stale PR going
 * unseen because GitHub masks BEHIND, a hopeless SHA re-dispatched forever, a
 * queued fire re-finalizing a torn-down slot, a recorded cron id overwritten
 * with null once CronList went blind, a counter silently dropped by the Edit
 * tool. Prose is the implementation here, so these assert the procedure still
 * says the load-bearing thing; they do NOT catch an agent that ignores the doc.
 *
 * Deliberately disjoint from the existing suites: rebase dedup keying lives in
 * pr-followup-conflict-dedup-key, cron-cancel wording in pr-followup-cron-guard,
 * blocked/respawn wiring in pr-followup-blocked-cron-lint.
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
const step0 = section(contract, /^### Step 0\b/m, /^### Step 1\b/m);
const step5 = section(contract, /^### Step 5\b/m, /^### Step 6\b/m);
const step6 = section(contract, /^### Step 6\b/m, /^### Step 7\b/m);
const writingState = section(contract, /^## Writing state\b/m, /^## Procedure\b/m);

describe("parser sanity: refuse to pass vacuously", () => {
  it("every contract section this suite reads was actually found", () => {
    const missing = Object.entries({ step0, step5, step6, writingState })
      .filter(([, body]) => body.trim().length === 0)
      .map(([name]) => name);
    expect(
      missing,
      `contract.md headings moved or were renamed, so these assertions would pass against empty strings: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

describe("Step 5 — staleness is read from commit ancestry, never mergeStateStatus", () => {
  it("keys out-of-date on behind_by from the compare call", () => {
    expect(/behind_by/.test(step5)).toBe(true);
    expect(/compare/i.test(step5)).toBe(true);
  });

  it("explicitly forbids mergeStateStatus == BEHIND as the source", () => {
    expect(
      /never\W{0,4}from\W{0,3}mergeStateStatus\s*==\s*BEHIND/i.test(step5),
      "the never-use-mergeStateStatus rule is what stops a stale PR going unseen — GitHub reports BLOCKED instead of BEHIND once a PR also awaits review or has a red check",
    ).toBe(true);
  });

  it("keeps the rationale so the rule is not mistaken for style", () => {
    expect(/masks\s*`?BEHIND`?\s*behind/i.test(step5)).toBe(true);
  });
});

describe("Step 6 — CI bucket routing and the fix budget", () => {
  it("idles while any check is still pending", () => {
    expect(/bucket\s*==\s*"pending"/.test(step6)).toBe(true);
    expect(/idle/i.test(step6)).toBe(true);
  });

  it("dispatches fix-ci only under the per-SHA attempt cap", () => {
    expect(/ci_fix_attempts\[head_sha\]\s*<\s*3/.test(step6)).toBe(true);
    expect(/fix ci/i.test(step6)).toBe(true);
  });

  it("excludes a SHA the fix-ci stage already gave up on", () => {
    expect(/ci_escalated_shas/.test(step6)).toBe(true);
  });

  it("stops re-dispatching once the budget is spent", () => {
    expect(/ci_fix_attempts\[head_sha\]\s*>=\s*3/.test(step6)).toBe(true);
    expect(
      /does not re-?dispatch/i.test(step6),
      "without this the watcher burns a cycle every minute on CI it can never fix",
    ).toBe(true);
  });
});

describe("Step 0 — stale-fire guard", () => {
  it("treats a fire on an already-terminal slot as stale", () => {
    expect(/stale/i.test(step0)).toBe(true);
    expect(/merged.*closed|closed.*merged/is.test(step0)).toBe(true);
  });

  it("cancels the lingering cron and logs a stale-tick", () => {
    expect(/cancel-cron\.md/.test(step0)).toBe(true);
    expect(/stale-tick/.test(step0)).toBe(true);
  });

  it("exits without re-finalizing", () => {
    expect(
      /(do not|never)[^.]*re-?finalize/i.test(step0),
      "re-finalizing a torn-down slot rewrites result.md and re-fires the terminal handoff",
    ).toBe(true);
  });
});

describe("record-cron-id — the recorded id survives CronList going blind", () => {
  const md = read("record-cron-id.md");

  it("records every tick, starting with the first", () => {
    expect(/every tick/i.test(md)).toBe(true);
  });

  it("never overwrites a non-null recorded id with null", () => {
    expect(/non-null/i.test(md)).toBe(true);
    expect(
      /never overwrite it with\s*`?null/i.test(md),
      "once CronList is blind the recorded id is the only CronDelete handle left — nulling it orphans the cron until the 7-day expiry",
    ).toBe(true);
  });

  it("skips recording on the stale-fire path", () => {
    expect(/stale-fire/i.test(md)).toBe(true);
  });
});

describe("session state is rewritten whole-file, never patched with Edit", () => {
  it("mandates a whole-file rewrite", () => {
    expect(/whole-file rewrite/i.test(writingState)).toBe(true);
  });

  it("bans the Edit tool on session JSON", () => {
    expect(
      /never\W{0,4}patch session JSON with the Edit tool/i.test(writingState),
      "an exact-string Edit against these files fails silently, so the counter never advances",
    ).toBe(true);
  });

  it("keeps the silent-failure rationale", () => {
    expect(/silently fails|malformed edit/i.test(writingState)).toBe(true);
  });
});

describe("SKILL.md routing — the error branches stay documented", () => {
  const skill = read("SKILL.md");

  it("errors when the named session dir is missing", () => {
    expect(/session dir missing/i.test(skill)).toBe(true);
    expect(
      /no session at/i.test(skill),
      "without this row a bare slug silently starts nothing",
    ).toBe(true);
  });

  it("refuses an ambiguous bare PR number instead of guessing a slot", () => {
    expect(/zero or multiple matches/i.test(skill)).toBe(true);
    expect(/ambiguous/i.test(skill)).toBe(true);
  });
});
