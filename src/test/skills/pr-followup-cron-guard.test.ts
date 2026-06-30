/**
 * Static lint for the muggle-pr-followup watcher's cron-cancellation wording.
 *
 * The watcher stops its per-minute cron with the `CronList`/`CronDelete` tools.
 * When the instruction reads like pseudocode an agent can wrap it in a Bash
 * call, which silently no-ops and orphans the cron (it then fires until the
 * 7-day expiry). The fix is a single `cancel-cron.md` carrying an explicit
 * "these are tool calls, not shell commands" guard, referenced from every
 * cancel site. This test keeps that invariant from regressing; it does NOT
 * catch an agent that ignores the doc.
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
const HELPER = "cancel-cron.md";

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

describe("muggle-pr-followup cron-cancellation guard", () => {
  const helperPath = path.join(WATCHER_DIR, HELPER);

  it("cancel-cron.md exists", () => {
    expect(
      fs.existsSync(helperPath),
      `${HELPER} is the single source of truth for cron cancellation — it must exist`,
    ).toBe(true);
  });

  describe("the helper carries the tool-not-shell guard", () => {
    const md = fs.existsSync(helperPath) ? read(helperPath) : "";

    it("names both Cron tools", () => {
      expect(/\bCronList\b/.test(md)).toBe(true);
      expect(/\bCronDelete\b/.test(md)).toBe(true);
    });

    it("states they are tool calls, not shell commands", () => {
      expect(/tool call/i.test(md)).toBe(true);
      expect(/not shell command|not (a )?shell|never .*\bbash\b/i.test(md)).toBe(
        true,
      );
    });

    it("warns that a bash invocation silently no-ops", () => {
      expect(/\bbash\b/i.test(md)).toBe(true);
      expect(/no-?op|silently/i.test(md)).toBe(true);
    });
  });

  describe("every cron-cancel mention routes through the helper", () => {
    const sites = markdownFiles(WATCHER_DIR).filter(
      (f) => path.basename(f) !== HELPER,
    );
    const offenders = sites
      .filter((f) => /\bCronDelete\b/.test(read(f)) && !read(f).includes(HELPER))
      .map((f) => path.relative(WATCHER_DIR, f));

    it("no file mentions CronDelete without referencing cancel-cron.md", () => {
      expect(
        offenders,
        `these files spell out CronDelete instead of deferring to ${HELPER} (re-inlining drops the tool-not-shell guard): ${offenders.join(", ")}`,
      ).toEqual([]);
    });
  });

  describe("parser sanity: refuse to pass vacuously", () => {
    it("at least one watcher file references the helper", () => {
      const refs = markdownFiles(WATCHER_DIR).filter(
        (f) => path.basename(f) !== HELPER && read(f).includes(HELPER),
      );
      expect(
        refs.length,
        "no watcher file references cancel-cron.md — the cancel sites are unwired",
      ).toBeGreaterThan(0);
    });
  });
});
