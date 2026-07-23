/**
 * Static wiring lint for the watch-arming sequence. The user-facing
 * guarantees: the watch is explicitly visible while it polls (a persistent,
 * labeled monitor) and gone at terminal; it is named after the PR; the drain
 * precedes the watch; and every entry point arms the same way. arm-watcher.md
 * owns none of the decision semantics — those live in contract.md.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "plugin/skills",
);
const read = (rel: string) => fs.readFileSync(path.join(SKILLS, rel), "utf8");
const armWatcher = read("muggle-pr-followup/arm-watcher.md");

describe("pr-followup arming wiring", () => {
  it("labels the watch after the PR and keeps it visibly running until terminal", () => {
    expect(armWatcher).toContain("PR #<n> — <title>");
    expect(armWatcher).toMatch(/persistent/i);
    expect(armWatcher).toMatch(/visible/i);
    expect(armWatcher).toMatch(/terminal/i);
  });

  // Drain-then-watch: the monitor compares against a watermark, so anything
  // not drained first is silently swallowed by a fresh watermark.
  it("drains before it watches — the tick precedes the monitor", () => {
    const tick = armWatcher.indexOf("contract.md");
    const watch = armWatcher.toLowerCase().indexOf("monitor");
    expect(tick).toBeGreaterThan(-1);
    expect(watch).toBeGreaterThan(-1);
    expect(tick).toBeLessThan(watch);
  });

  it("requires the watermark to be passed in, not self-captured", () => {
    expect(armWatcher).toMatch(/pass the watermark in/i);
  });

  it("every arming point routes through arm-watcher.md", () => {
    for (const rel of [
      "muggle-pr-followup/bootstrap.md",
      "muggle-pr-followup/auto-track.md",
      "do/respawn-watcher.md",
    ]) {
      expect(read(rel), `${rel} does not arm via arm-watcher.md`).toMatch(
        /arm-watcher\.md/,
      );
    }
  });

  it("owns none of the tick's decision semantics", () => {
    const owned = ["isResolved", "isOutdated", "muggle-do:bot", "ci_fix_attempts",
      "ci_escalated_shas", "conflict_resolve_attempts", "conflict_escalated_keys",
      "escalated_review_ids", "behind_by", "mergeStateStatus", "lastBodyReviewId"];
    expect(owned.filter((term) => armWatcher.includes(term))).toEqual([]);
  });
});
