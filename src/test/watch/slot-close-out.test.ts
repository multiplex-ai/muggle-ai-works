import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { ProviderPrState } from "../../guardrails/types.js";
import { computeCoverage } from "../../watch/findings.js";
import { isSlotCloseOutDue } from "../../watch/recovery.js";
import { WatcherLiveness, type WatchSlotAssessment } from "../../watch/types.js";
import { closeOutWatchSlot, readOpenWatchSlots } from "../../watch/watch-slots.js";
import { makeTempDir, openPrEntry, writeSlot } from "./fixtures.js";

const NOW = new Date("2026-10-25T21:00:00.123Z");

function assessment(overrides: Partial<WatchSlotAssessment>): WatchSlotAssessment {
  return {
    slug: "s",
    slotDir: "/s",
    pr: { repo: "o/r", number: 1, url: "u1" },
    isRegistered: true,
    watcher: WatcherLiveness.Dead,
    isOwnerSessionActive: false,
    live: { url: "u1", state: ProviderPrState.Merged, unresolvedThreadCount: 0 },
    ...overrides,
  };
}

describe("isSlotCloseOutDue", () => {
  it("closes out a terminal PR only when no loop and no running owner will", () => {
    expect(isSlotCloseOutDue(assessment({}))).toBe(true);
    expect(isSlotCloseOutDue(assessment({ live: { url: "u1", state: ProviderPrState.Closed, unresolvedThreadCount: 0 } }))).toBe(true);
    expect(isSlotCloseOutDue(assessment({ isOwnerSessionActive: undefined, isRegistered: false }))).toBe(true);
    expect(isSlotCloseOutDue(assessment({ isOwnerSessionActive: true }))).toBe(false);
    expect(isSlotCloseOutDue(assessment({ watcher: WatcherLiveness.Polling }))).toBe(false);
    expect(isSlotCloseOutDue(assessment({ live: { url: "u1", state: ProviderPrState.Open, unresolvedThreadCount: 0 } }))).toBe(false);
    expect(isSlotCloseOutDue(assessment({ live: undefined }))).toBe(false);
  });
});

describe("closeOutWatchSlot", () => {
  it("marks the PR terminal, logs it, and writes the result with the slot's own history", () => {
    const slotsDir = makeTempDir("close-out");
    const slotDir = writeSlot(slotsDir, "csv-export", { prsJson: [openPrEntry("o/r", 7)] });
    writeFileSync(join(slotDir, "last_seen.json"), JSON.stringify({ "o/r#7": { cycles_completed: 2, pushed_shas: ["a1", "b2"], escalated_review_ids: [] } }));
    const pr = { repo: "o/r", number: 7, url: "https://github.com/o/r/pull/7" };

    expect(closeOutWatchSlot(slotDir, pr, "merged", NOW)).toBe(true);
    expect(JSON.parse(readFileSync(join(slotDir, "prs.json"), "utf-8"))[0].state).toBe("merged");
    expect(readFileSync(join(slotDir, "followup.log"), "utf-8")).toBe("2026-10-25T21:00:00Z tick pr=7 terminal=merged closed-out-by=muggle-watch\n");
    const result = readFileSync(join(slotDir, "result.md"), "utf-8");
    expect(result).toContain("# Result — csv-export");
    expect(result).toContain("**Cycles completed:** 2");
    expect(result).toContain("**Pushed SHAs:** a1, b2");
    expect(result).toContain("**Escalated review ids:** none");
    expect(result).toContain("post-merge cleanup not run");
    expect(readOpenWatchSlots(slotsDir)).toEqual([]);
  });

  it("writes no result while another PR in the slot is still open, and keeps an existing result", () => {
    const slotDir = writeSlot(makeTempDir("close-out"), "pair", { prsJson: [openPrEntry("o/r", 1), openPrEntry("o/r", 2)] });
    expect(closeOutWatchSlot(slotDir, { repo: "o/r", number: 1, url: "https://github.com/o/r/pull/1" }, "closed", NOW)).toBe(true);
    expect(existsSync(join(slotDir, "result.md"))).toBe(false);
    writeFileSync(join(slotDir, "result.md"), "kept\n");
    expect(closeOutWatchSlot(slotDir, { repo: "o/r", number: 2, url: "https://github.com/o/r/pull/2" }, "merged", NOW)).toBe(true);
    expect(readFileSync(join(slotDir, "result.md"), "utf-8")).toBe("kept\n");
  });

  it("closes a single-object prs.json, history unknown, and refuses a slot it cannot read", () => {
    const slotDir = writeSlot(makeTempDir("close-out"), "single", { prsJson: openPrEntry("o/r", 3) });
    expect(closeOutWatchSlot(slotDir, { repo: "o/r", number: 3, url: "https://github.com/o/r/pull/3" }, "closed", NOW)).toBe(true);
    expect(JSON.parse(readFileSync(join(slotDir, "prs.json"), "utf-8")).state).toBe("closed");
    expect(readFileSync(join(slotDir, "result.md"), "utf-8")).toContain("**Cycles completed:** unknown");
    expect(closeOutWatchSlot(writeSlot(makeTempDir("close-out"), "empty", {}), { repo: "o/r", number: 4, url: "u4" }, "merged", NOW)).toBe(false);
  });
});

describe("computeCoverage", () => {
  it("counts only PRs GitHub confirms open, per repo", () => {
    const open = { url: "u", state: ProviderPrState.Open, unresolvedThreadCount: 0 };
    const coverage = computeCoverage([
      assessment({ pr: { repo: "o/b", number: 1, url: "u" }, live: open, watcher: WatcherLiveness.Polling }),
      assessment({ pr: { repo: "o/b", number: 2, url: "u" }, live: open, watcher: WatcherLiveness.Rearming }),
      assessment({ pr: { repo: "o/b", number: 3, url: "u" }, live: open, watcher: WatcherLiveness.Deaf }),
      assessment({ pr: { repo: "o/a", number: 4, url: "u" }, live: open, watcher: WatcherLiveness.Dead }),
      assessment({ pr: { repo: "o/a", number: 5, url: "u" } }),
      assessment({ pr: { repo: "o/c", number: 6, url: "u" }, live: undefined }),
    ]);
    expect(coverage).toEqual([
      { repo: "o/a", watched: 0, deaf: 0, dead: 1 },
      { repo: "o/b", watched: 2, deaf: 1, dead: 0 },
    ]);
  });
});
