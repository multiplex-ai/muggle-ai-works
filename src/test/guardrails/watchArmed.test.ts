import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  isWatchSkipMarker,
  applyWatchSkip,
  findUnarmedHandledPrs,
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
    expect(isWatchSkipMarker('echo "MUGGLE_WATCH_SKIP: manual PR"')).toBe(true);
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
  it("None when a skip was recorded, even with owed PRs", () => {
    const d = watchGateDecision(base({ watchSkipped: true }), ["https://x/pull/1"]);
    expect(d.action).toBe(WatchGateAction.None);
  });
  it("Block and increments the count when a PR is owed", () => {
    const d = watchGateDecision(base(), ["https://x/pull/1"]);
    expect(d.action).toBe(WatchGateAction.Block);
    expect(d.blockCount).toBe(1);
    expect(d.owed).toEqual(["https://x/pull/1"]);
  });
  it("Release after the block budget is spent, so an un-watchable PR can't trap the session", () => {
    const d = watchGateDecision(base({ watchBlockCount: 3 }), ["https://x/pull/1"]);
    expect(d.action).toBe(WatchGateAction.Release);
  });
});

describe("findUnarmedHandledPrs", () => {
  let sessions: string;
  const seedSlot = (slug: string, url: string, files: Record<string, string>): void => {
    const dir = join(sessions, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "prs.json"), JSON.stringify([{ url: url }]));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  };

  beforeEach(() => {
    sessions = mkdtempSync(join(tmpdir(), "watch-scan-"));
  });

  it("owes a handled url with no slot at all", () => {
    expect(findUnarmedHandledPrs(["https://x/pull/1"], sessions)).toEqual(["https://x/pull/1"]);
  });

  it("owes a slot whose watch.pid is dead and heartbeat absent", () => {
    seedSlot("s1", "https://x/pull/1", { "watch.pid": "999999999" });
    expect(findUnarmedHandledPrs(["https://x/pull/1"], sessions)).toEqual(["https://x/pull/1"]);
  });

  it("does not owe a slot with a live watch.pid", () => {
    seedSlot("s2", "https://x/pull/2", { "watch.pid": String(process.pid) });
    expect(findUnarmedHandledPrs(["https://x/pull/2"], sessions)).toEqual([]);
  });

  it("does not owe a terminal slot (result.md present)", () => {
    seedSlot("s3", "https://x/pull/3", { "result.md": "# done", "watch.pid": "999999999" });
    expect(findUnarmedHandledPrs(["https://x/pull/3"], sessions)).toEqual([]);
  });

  it("does not owe a slot with a fresh heartbeat", () => {
    seedSlot("s4", "https://x/pull/4", { "watch-heartbeat": "" });
    expect(findUnarmedHandledPrs(["https://x/pull/4"], sessions)).toEqual([]);
  });

  it("returns only the owed subset across a mix", () => {
    seedSlot("armed", "https://x/pull/10", { "watch.pid": String(process.pid) });
    seedSlot("dead", "https://x/pull/11", { "watch.pid": "999999999" });
    const owed = findUnarmedHandledPrs(
      ["https://x/pull/10", "https://x/pull/11", "https://x/pull/12"],
      sessions,
    );
    expect(owed.sort()).toEqual(["https://x/pull/11", "https://x/pull/12"]);
  });

  it("returns [] for no handled urls without scanning", () => {
    expect(findUnarmedHandledPrs([], sessions)).toEqual([]);
  });
});
