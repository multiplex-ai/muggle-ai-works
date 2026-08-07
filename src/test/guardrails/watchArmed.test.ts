import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  isWatchSkipMarker,
  applyWatchSkip,
  findUntrackedHandledPrs,
  watchGateDecision,
} from "../../guardrails/watchArmed.js";
import { WatchGateAction, type GuardrailState } from "../../guardrails/types.js";

const base = (over: Partial<GuardrailState> = {}): GuardrailState => ({
  sessionId: "s",
  prsHandled: [],
  ...over,
});

describe("isWatchSkipMarker", () => {
  it("matches a leading MUGGLE_WATCH_SKIP echo", () => {
    expect(isWatchSkipMarker('echo "MUGGLE_WATCH_SKIP: handed off"')).toBe(true);
    expect(isWatchSkipMarker("echo MUGGLE_WATCH_SKIP: x")).toBe(true);
  });
  it("ignores a mere mention (grep, commit, skill edit)", () => {
    expect(isWatchSkipMarker('grep -r "MUGGLE_WATCH_SKIP" .')).toBe(false);
    expect(isWatchSkipMarker("git commit -m 'add MUGGLE_WATCH_SKIP marker'")).toBe(false);
  });
});

describe("applyWatchSkip", () => {
  it("sets watchSkipped and returns a new object", () => {
    const state = base();
    const next = applyWatchSkip(state, true);
    expect(next).not.toBe(state);
    expect(next.watchSkipped).toBe(true);
  });
  it("returns the same reference when not skipping or already skipped", () => {
    const state = base();
    expect(applyWatchSkip(state, false)).toBe(state);
    const skipped = base({ watchSkipped: true });
    expect(applyWatchSkip(skipped, true)).toBe(skipped);
  });
});

describe("watchGateDecision", () => {
  it("None when nothing was opened this session", () => {
    expect(watchGateDecision(base(), []).action).toBe(WatchGateAction.None);
  });
  it("None when a skip was recorded, even with untracked PRs", () => {
    const decision = watchGateDecision(base({ watchSkipped: true }), ["https://x/pull/1"]);
    expect(decision.action).toBe(WatchGateAction.None);
  });
  it("Block and increments the count when a PR is untracked", () => {
    const decision = watchGateDecision(base(), ["https://x/pull/1"]);
    expect(decision.action).toBe(WatchGateAction.Block);
    expect(decision.blockCount).toBe(1);
    expect(decision.untracked).toEqual(["https://x/pull/1"]);
  });
  it("Release after the block budget is spent, so an untrackable PR can't trap the session", () => {
    const decision = watchGateDecision(base({ watchBlockCount: 3 }), ["https://x/pull/1"]);
    expect(decision.action).toBe(WatchGateAction.Release);
  });
});

describe("findUntrackedHandledPrs", () => {
  let sessions: string;
  const seedSlot = (slug: string, url: string, files: Record<string, string> = {}): void => {
    const dir = join(sessions, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "prs.json"), JSON.stringify([{ url: url }]));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  };

  beforeEach(() => {
    sessions = mkdtempSync(join(tmpdir(), "watch-scan-"));
  });

  it("reports a handled url with no slot at all", () => {
    expect(findUntrackedHandledPrs(["https://x/pull/1"], sessions)).toEqual(["https://x/pull/1"]);
  });

  // The seeded-but-not-yet-armed slot is the state a background job legitimately
  // ends in. Reconcile arms it at the next session start, so the gate must not
  // fire and push the caller toward the skip hatch.
  it("accepts a seeded slot with no watcher yet", () => {
    seedSlot("seeded", "https://x/pull/2");
    expect(findUntrackedHandledPrs(["https://x/pull/2"], sessions)).toEqual([]);
  });

  it("accepts a slot whose watcher died (stale pid, no heartbeat)", () => {
    seedSlot("dead", "https://x/pull/3", { "watch.pid": "999999999" });
    expect(findUntrackedHandledPrs(["https://x/pull/3"], sessions)).toEqual([]);
  });

  it("accepts a live-monitor slot and a terminal slot alike", () => {
    seedSlot("live", "https://x/pull/4", { "watch.pid": String(process.pid) });
    seedSlot("done", "https://x/pull/5", { "result.md": "# merged" });
    expect(findUntrackedHandledPrs(["https://x/pull/4", "https://x/pull/5"], sessions)).toEqual([]);
  });

  it("reports only the urls no slot tracks", () => {
    seedSlot("tracked", "https://x/pull/10");
    const untracked = findUntrackedHandledPrs(
      ["https://x/pull/10", "https://x/pull/11", "https://x/pull/12"],
      sessions,
    );
    expect(untracked.sort()).toEqual(["https://x/pull/11", "https://x/pull/12"]);
  });

  it("ignores a slot dir with no prs.json and one with malformed json", () => {
    mkdirSync(join(sessions, "empty"), { recursive: true });
    mkdirSync(join(sessions, "broken"), { recursive: true });
    writeFileSync(join(sessions, "broken", "prs.json"), "{not json");
    expect(findUntrackedHandledPrs(["https://x/pull/20"], sessions)).toEqual(["https://x/pull/20"]);
  });

  it("returns [] for no handled urls without scanning", () => {
    expect(findUntrackedHandledPrs([], sessions)).toEqual([]);
  });
});
