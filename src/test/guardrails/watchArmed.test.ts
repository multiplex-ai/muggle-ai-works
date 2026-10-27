import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  isWatchSkipMarker,
  applyWatchSkip,
  findUnwatchedHandledPrs,
  lookupProviderPrState,
  ownsOpenWatchSlot,
  prsAwaitingStateScan,
  resolveOwedWatchPrs,
  resolveWatchSlotStatus,
  scanProviderPrStates,
  watchGateDecision,
} from "../../guardrails/watchArmed.js";
import { WATCH_HEARTBEAT_STALE_MS } from "../../guardrails/constants.js";
import {
  ProviderPrState,
  WatchGateAction,
  WatchSlotStatus,
  type GuardrailState,
  type WatchSlotEvidence,
} from "../../guardrails/types.js";

const base = (over: Partial<GuardrailState> = {}): GuardrailState => ({
  sessionId: "s",
  prsHandled: [],
  ...over,
});

const NOW_MS = 1_800_000_000_000;

const evidence = (over: Partial<WatchSlotEvidence> = {}): WatchSlotEvidence => ({
  isStopped: false,
  isFinalized: false,
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
  it("None when a skip was recorded, even with unwatched PRs", () => {
    const decision = watchGateDecision(base({ watchSkipped: true }), ["https://x/pull/1"]);
    expect(decision.action).toBe(WatchGateAction.None);
  });
  it("Block and increments the count when a PR is unwatched", () => {
    const decision = watchGateDecision(base(), ["https://x/pull/1"]);
    expect(decision.action).toBe(WatchGateAction.Block);
    expect(decision.blockCount).toBe(1);
    expect(decision.unwatched).toEqual(["https://x/pull/1"]);
  });
  it("Release after the block budget is spent, so an unwatchable PR can't trap the session", () => {
    const decision = watchGateDecision(base({ watchBlockCount: 3 }), ["https://x/pull/1"]);
    expect(decision.action).toBe(WatchGateAction.Release);
  });
});

describe("resolveWatchSlotStatus", () => {
  it("Live when the heartbeat is inside the staleness window", () => {
    expect(resolveWatchSlotStatus(evidence({ heartbeatMtimeMs: NOW_MS - 60_000 }), NOW_MS)).toBe(
      WatchSlotStatus.Live,
    );
  });

  it("Stale once the heartbeat is older than the window", () => {
    const staleMtimeMs = NOW_MS - WATCH_HEARTBEAT_STALE_MS - 1;
    expect(resolveWatchSlotStatus(evidence({ heartbeatMtimeMs: staleMtimeMs }), NOW_MS)).toBe(
      WatchSlotStatus.Stale,
    );
  });

  it("Stale for a seeded slot no loop ever touched", () => {
    expect(resolveWatchSlotStatus(evidence(), NOW_MS)).toBe(WatchSlotStatus.Stale);
  });

  it("Terminal for a finalized slot or a recorded merged/closed state, heartbeat or not", () => {
    expect(resolveWatchSlotStatus(evidence({ isFinalized: true }), NOW_MS)).toBe(WatchSlotStatus.Terminal);
    expect(resolveWatchSlotStatus(evidence({ recordedPrState: "merged" }), NOW_MS)).toBe(WatchSlotStatus.Terminal);
    expect(resolveWatchSlotStatus(evidence({ recordedPrState: "CLOSED" }), NOW_MS)).toBe(WatchSlotStatus.Terminal);
    expect(resolveWatchSlotStatus(evidence({ recordedPrState: "open" }), NOW_MS)).toBe(WatchSlotStatus.Stale);
  });

  it("Stopped for a slot its owner stopped", () => {
    expect(resolveWatchSlotStatus(evidence({ isStopped: true }), NOW_MS)).toBe(WatchSlotStatus.Stopped);
  });
});

describe("findUnwatchedHandledPrs", () => {
  let sessions: string;
  const seedSlot = (
    slug: string,
    url: string,
    files: Record<string, string> = {},
    prState: string = "open",
  ): string => {
    const dir = join(sessions, slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "prs.json"), JSON.stringify([{ url: url, state: prState }]));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    return dir;
  };

  beforeEach(() => {
    sessions = mkdtempSync(join(tmpdir(), "watch-scan-"));
  });

  it("reports a handled url with no slot at all", () => {
    expect(findUnwatchedHandledPrs(["https://x/pull/1"], sessions)).toEqual(["https://x/pull/1"]);
  });

  it("reports a slot that is only seeded — no loop, no heartbeat", () => {
    seedSlot("seeded", "https://x/pull/2");
    expect(findUnwatchedHandledPrs(["https://x/pull/2"], sessions)).toEqual(["https://x/pull/2"]);
  });

  it("accepts a slot whose loop touched its heartbeat within the window", () => {
    seedSlot("live", "https://x/pull/3", { "watch-heartbeat": "" });
    expect(findUnwatchedHandledPrs(["https://x/pull/3"], sessions)).toEqual([]);
  });

  // watch.pid is not consulted: a stale beacon beside a pid that looks live is a
  // dead or deaf loop, and on Windows the pid is an MSYS id Node cannot probe.
  it("reports a slot whose heartbeat went stale, whatever watch.pid says", () => {
    const dir = seedSlot("dead", "https://x/pull/4", {
      "watch-heartbeat": "",
      "watch.pid": String(process.pid),
    });
    const staleSeconds = (Date.now() - WATCH_HEARTBEAT_STALE_MS - 60_000) / 1000;
    utimesSync(join(dir, "watch-heartbeat"), staleSeconds, staleSeconds);
    expect(findUnwatchedHandledPrs(["https://x/pull/4"], sessions)).toEqual(["https://x/pull/4"]);
  });

  it("accepts a terminal slot — finalized, or merged per prs.json — with no heartbeat", () => {
    seedSlot("done", "https://x/pull/5", { "result.md": "# merged" });
    seedSlot("merged", "https://x/pull/6", {}, "merged");
    expect(findUnwatchedHandledPrs(["https://x/pull/5", "https://x/pull/6"], sessions)).toEqual([]);
  });

  it("accepts a slot its owner stopped, so the gate never pushes to revive it", () => {
    seedSlot("r-pr7.stopped", "https://x/pull/7");
    expect(findUnwatchedHandledPrs(["https://x/pull/7"], sessions)).toEqual([]);
  });

  it("counts a PR watched when any of its slots is live", () => {
    seedSlot("old", "https://x/pull/8");
    seedSlot("new", "https://x/pull/8", { "watch-heartbeat": "" });
    expect(findUnwatchedHandledPrs(["https://x/pull/8"], sessions)).toEqual([]);
  });

  it("reports only the urls no live slot covers", () => {
    seedSlot("watched", "https://x/pull/10", { "watch-heartbeat": "" });
    const unwatched = findUnwatchedHandledPrs(
      ["https://x/pull/10", "https://x/pull/11", "https://x/pull/12"],
      sessions,
    );
    expect(unwatched.sort()).toEqual(["https://x/pull/11", "https://x/pull/12"]);
  });

  it("ignores a slot dir with no prs.json and one with malformed json", () => {
    mkdirSync(join(sessions, "empty"), { recursive: true });
    mkdirSync(join(sessions, "broken"), { recursive: true });
    writeFileSync(join(sessions, "broken", "prs.json"), "{not json");
    writeFileSync(join(sessions, "broken", "watch-heartbeat"), "");
    expect(findUnwatchedHandledPrs(["https://x/pull/20"], sessions)).toEqual(["https://x/pull/20"]);
  });

  it("reports every url when the sessions dir is missing", () => {
    expect(findUnwatchedHandledPrs(["https://x/pull/21"], join(sessions, "absent"))).toEqual([
      "https://x/pull/21",
    ]);
  });

  it("returns [] for no handled urls without scanning", () => {
    expect(findUnwatchedHandledPrs([], sessions)).toEqual([]);
  });
});

describe("ownsOpenWatchSlot", () => {
  const SESSION_ID = "chat-1";
  let sessions: string;
  const seedSlot = (slug: string, files: Record<string, string>): void => {
    const dir = join(sessions, slug);
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  };
  const ownedBy = (sessionId: string): string => JSON.stringify({ session_id: sessionId, claimed_at: "2026-10-26T00:00:00Z" });
  const prsJson = (prState: string): string => JSON.stringify([{ url: "https://x/pull/1", state: prState }]);

  beforeEach(() => {
    sessions = mkdtempSync(join(tmpdir(), "owned-scan-"));
  });

  it("is true for an owned slot whose PR is open, live heartbeat or not", () => {
    seedSlot("seeded", { "owner.json": ownedBy(SESSION_ID), "prs.json": prsJson("OPEN") });
    expect(ownsOpenWatchSlot(SESSION_ID, sessions)).toBe(true);
  });

  it("is false when every open slot belongs to another session or to none", () => {
    seedSlot("foreign", { "owner.json": ownedBy("chat-2"), "prs.json": prsJson("OPEN") });
    seedSlot("unowned", { "prs.json": prsJson("OPEN") });
    expect(ownsOpenWatchSlot(SESSION_ID, sessions)).toBe(false);
  });

  it("is false for an owned slot that is finalized or records its PR merged or closed", () => {
    seedSlot("finalized", { "owner.json": ownedBy(SESSION_ID), "prs.json": prsJson("OPEN"), "result.md": "# merged" });
    seedSlot("merged", { "owner.json": ownedBy(SESSION_ID), "prs.json": prsJson("MERGED") });
    seedSlot("closed", { "owner.json": ownedBy(SESSION_ID), "prs.json": prsJson("closed") });
    expect(ownsOpenWatchSlot(SESSION_ID, sessions)).toBe(false);
  });

  it("is false for an owned slot with no readable PR", () => {
    seedSlot("no-prs", { "owner.json": ownedBy(SESSION_ID) });
    seedSlot("broken", { "owner.json": ownedBy(SESSION_ID), "prs.json": "{not json" });
    expect(ownsOpenWatchSlot(SESSION_ID, sessions)).toBe(false);
  });

  it("is false for an empty session id or a missing sessions dir", () => {
    seedSlot("blank-owner", { "owner.json": ownedBy(""), "prs.json": prsJson("OPEN") });
    expect(ownsOpenWatchSlot("", sessions)).toBe(false);
    expect(ownsOpenWatchSlot(SESSION_ID, join(sessions, "absent"))).toBe(false);
  });
});

describe("resolveOwedWatchPrs", () => {
  const PR = "https://github.com/o/r/pull/233";

  it("keeps a PR no scan has reached yet, so a missing slot still blocks", () => {
    expect(resolveOwedWatchPrs([PR], base(), null)).toEqual([PR]);
    expect(resolveOwedWatchPrs([PR], base(), { states: {} })).toEqual([PR]);
  });

  it("keeps a PR the provider reports open", () => {
    expect(resolveOwedWatchPrs([PR], base(), { states: { [PR]: ProviderPrState.Open } })).toEqual([PR]);
  });

  // The post-merge cleanup deletes the slot, so a merged PR reaches the gate as
  // unwatched; the provider's verdict is what clears it.
  it("clears a PR the provider reports merged or closed", () => {
    expect(resolveOwedWatchPrs([PR], base(), { states: { [PR]: ProviderPrState.Merged } })).toEqual([]);
    expect(resolveOwedWatchPrs([PR], base(), { states: { [PR]: ProviderPrState.Closed } })).toEqual([]);
  });

  it("fails open on a lookup that could not reach the provider", () => {
    expect(resolveOwedWatchPrs([PR], base(), { states: { [PR]: ProviderPrState.Unreachable } })).toEqual([]);
  });

  it("clears a PR the session saw go terminal, with no scan at all", () => {
    expect(resolveOwedWatchPrs([PR], base({ terminalPending: [233] }), null)).toEqual([]);
    expect(resolveOwedWatchPrs([PR], base({ terminalHandled: [233] }), null)).toEqual([]);
    expect(resolveOwedWatchPrs([PR], base({ terminalHandled: [234] }), null)).toEqual([PR]);
  });
});

describe("prsAwaitingStateScan", () => {
  const OPEN_PR = "https://github.com/o/r/pull/1";
  const MERGED_PR = "https://github.com/o/r/pull/2";
  const UNREACHED_PR = "https://github.com/o/r/pull/3";
  const SEEN_TERMINAL_PR = "https://github.com/o/r/pull/4";

  it("re-reads open, unscanned, and unreachable PRs, never settled ones", () => {
    const awaiting = prsAwaitingStateScan(
      [OPEN_PR, MERGED_PR, UNREACHED_PR, SEEN_TERMINAL_PR, "https://github.com/o/r/pull/5"],
      base({ terminalHandled: [4] }),
      {
        states: {
          [OPEN_PR]: ProviderPrState.Open,
          [MERGED_PR]: ProviderPrState.Merged,
          [UNREACHED_PR]: ProviderPrState.Unreachable,
        },
      },
    );
    expect(awaiting).toEqual([OPEN_PR, UNREACHED_PR, "https://github.com/o/r/pull/5"]);
  });
});

describe("lookupProviderPrState", () => {
  const PR = "https://github.com/o/r/pull/9";

  it("asks gh for the PR's state and maps its answer", () => {
    const calls: string[][] = [];
    const providerState = lookupProviderPrState(PR, (args) => {
      calls.push(args);
      return "MERGED\n";
    });
    expect(providerState).toBe(ProviderPrState.Merged);
    expect(calls).toEqual([["pr", "view", PR, "--json", "state", "-q", ".state"]]);
  });

  it("reports Unreachable when gh fails or answers something unknown", () => {
    expect(lookupProviderPrState(PR, () => null)).toBe(ProviderPrState.Unreachable);
    expect(lookupProviderPrState(PR, () => "UNREACHABLE")).toBe(ProviderPrState.Unreachable);
    expect(lookupProviderPrState(PR, () => "gh: not found")).toBe(ProviderPrState.Unreachable);
  });

  it("skips a url gh cannot answer for, such as a GitLab MR", () => {
    const gitlabMr = "https://gitlab.com/g/p/-/merge_requests/3";
    expect(lookupProviderPrState(gitlabMr, () => "OPEN")).toBeNull();
  });
});

describe("scanProviderPrStates", () => {
  it("records each covered PR's state and leaves out the uncovered ones", () => {
    const scan = scanProviderPrStates(["https://github.com/o/r/pull/1", "https://gitlab.com/g/p/-/merge_requests/2"], (prUrl) =>
      prUrl.includes("github.com") ? ProviderPrState.Merged : null,
    );
    expect(scan).toEqual({ states: { "https://github.com/o/r/pull/1": ProviderPrState.Merged } });
  });
});
