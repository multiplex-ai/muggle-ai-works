import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";
import { ProviderPrState } from "../../guardrails/types.js";
import { MUGGLE_PLUGIN_ID } from "../../watch/constants.js";
import { readMugglePluginUpdatedAtMs } from "../../watch/plugins-updated.js";
import { buildPrStatusRequest, fetchPrLiveStatuses, parsePullRequestNode } from "../../watch/pr-status.js";
import { partitionByTerminalCache, updateTerminalCache } from "../../watch/terminal-pr-cache.js";
import { CiRollupState, PrMergeable, PrMergeStateStatus, ServiceLoopReportKind } from "../../watch/types.js";
import {
  isPrPollingDisabled,
  readOpenWatchSlots,
  removeSlotRegistration,
  writeSlotRegistration,
} from "../../watch/watch-slots.js";
import { makeTempDir, openPrEntry, scriptedRunner, succeeded, writeSlot } from "./fixtures.js";

describe("readOpenWatchSlots", () => {
  it("returns only slots that still owe a watch on an open GitHub PR", () => {
    const slotsDir = join(makeTempDir("slots"), "sessions");
    writeSlot(slotsDir, "live", { prsJson: [openPrEntry("o/r", 1)], ownerSessionId: "owner-1", heartbeatMtimeMs: 1_000_000, isRegistered: true });
    writeSlot(slotsDir, "single-object", { prsJson: openPrEntry("o/r", 2) });
    writeSlot(slotsDir, "stopped.stopped", { prsJson: [openPrEntry("o/r", 3)] });
    writeSlot(slotsDir, "finalized", { prsJson: [openPrEntry("o/r", 4)], isFinalized: true });
    writeSlot(slotsDir, "merged", { prsJson: [{ ...openPrEntry("o/r", 5), state: "merged" }] });
    writeSlot(slotsDir, "gitlab", { prsJson: [{ ...openPrEntry("o/r", 6), provider: "gitlab" }] });
    writeSlot(slotsDir, "bad-url", { prsJson: [{ url: "https://example.com/x", state: "open" }] });
    writeSlot(slotsDir, "no-prs", {});
    const slots = readOpenWatchSlots(slotsDir);
    expect(slots.map((slot) => slot.slug).sort()).toEqual(["live", "single-object"]);
    expect(slots.find((slot) => slot.slug === "live")).toMatchObject({
      ownerSessionId: "owner-1",
      heartbeatMtimeMs: 1_000_000,
      isRegistered: true,
      openPrs: [{ repo: "o/r", number: 1, url: "https://github.com/o/r/pull/1", headSha: "abc123" }],
    });
    expect(slots.find((slot) => slot.slug === "single-object")).toMatchObject({ isRegistered: false, ownerSessionId: undefined, heartbeatMtimeMs: undefined });
  });

  it("carries the slot's last_seen.json text and followup.log lines, empty when absent", () => {
    const slotsDir = join(makeTempDir("slots"), "sessions");
    const lastSeen = { "o/r#1": { ci_escalated_shas: ["abc123"] } };
    writeSlot(slotsDir, "escalated", { prsJson: [openPrEntry("o/r", 1)], lastSeen: lastSeen, followupLog: "t1 tick pr=1\r\nt2 fix-ci pr=1 escalated: x\n" });
    writeSlot(slotsDir, "bare", { prsJson: [openPrEntry("o/r", 2)] });
    const slots = readOpenWatchSlots(slotsDir);
    expect(slots.find((slot) => slot.slug === "escalated")).toMatchObject({
      lastSeenJson: JSON.stringify(lastSeen),
      followupLogLines: ["t1 tick pr=1", "t2 fix-ci pr=1 escalated: x", ""],
    });
    expect(slots.find((slot) => slot.slug === "bare")).toMatchObject({ lastSeenJson: "", followupLogLines: [""] });
  });

  it("knows a loop the watch started, and the report its last such loop left", () => {
    const slotsDir = join(makeTempDir("slots"), "sessions");
    const serviceSlot = writeSlot(slotsDir, "service", { prsJson: [openPrEntry("o/r", 1)] });
    writeFileSync(join(serviceSlot, "watch-listener"), "muggle-watch\n");
    writeFileSync(join(serviceSlot, "watch-service.out"), "DRAIN pr=1 state=OPEN\nEVENT pr=1 new thread comment id=7\n");
    writeSlot(slotsDir, "session", { prsJson: [openPrEntry("o/r", 2)] });
    const slots = readOpenWatchSlots(slotsDir);
    expect(slots.find((slot) => slot.slug === "service")).toMatchObject({
      isHeardByService: true,
      serviceLoopReport: { kind: ServiceLoopReportKind.Event, reportLines: ["EVENT pr=1 new thread comment id=7"] },
    });
    expect(slots.find((slot) => slot.slug === "session")).toMatchObject({ isHeardByService: false, serviceLoopReport: undefined });
  });

  it("reads a missing sessions dir as no slots", () => {
    expect(readOpenWatchSlots(join(makeTempDir("slots"), "absent"))).toEqual([]);
  });
});

describe("slot registration", () => {
  it("writes, refreshes and removes the registration file", () => {
    const slotDir = writeSlot(join(makeTempDir("slots"), "sessions"), "csv", { prsJson: [openPrEntry("o/r", 1)] });
    writeSlotRegistration(slotDir, "muggle-watch-cli", new Date("2026-10-24T01:02:03Z"));
    expect(JSON.parse(readFileSync(join(slotDir, "watch-registration.json"), "utf-8"))).toEqual({
      registered_at: "2026-10-24T01:02:03.000Z",
      registered_by: "muggle-watch-cli",
    });
    expect(removeSlotRegistration(slotDir)).toBe(true);
    expect(existsSync(join(slotDir, "watch-registration.json"))).toBe(false);
    expect(removeSlotRegistration(slotDir)).toBe(false);
  });

  it("refuses to register a slot with nothing to watch", () => {
    const slotDir = writeSlot(join(makeTempDir("slots"), "sessions"), "empty", {});
    expect(() => writeSlotRegistration(slotDir, "test", new Date())).toThrow(/no prs\.json/);
  });

  it("reads the global kill switch beside the slot dirs", () => {
    const slotsDir = join(makeTempDir("slots"), "sessions");
    mkdirSync(slotsDir, { recursive: true });
    expect(isPrPollingDisabled(slotsDir)).toBe(false);
    writeFileSync(join(dirname(slotsDir), "polling.disabled"), "");
    expect(isPrPollingDisabled(slotsDir)).toBe(true);
  });
});

describe("PR live status", () => {
  const prs = [
    { repo: "o/r", number: 1, url: "https://github.com/o/r/pull/1" },
    { repo: "o/other", number: 22, url: "https://github.com/o/other/pull/22" },
  ];

  it("passes every coordinate as a typed variable rather than splicing it into the query", () => {
    const args = buildPrStatusRequest(prs);
    expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
    const query = args[3];
    expect(query).toContain("query($o0: String!, $r0: String!, $n0: Int!, $o1: String!, $r1: String!, $n1: Int!)");
    expect(query).toContain("fragment WatchPr on PullRequest");
    expect(query).not.toContain("o/other");
    expect(args.slice(4)).toEqual(["-f", "o0=o", "-f", "r0=r", "-F", "n0=1", "-f", "o1=o", "-f", "r1=other", "-F", "n1=22"]);
  });

  it("parses a node into a live status", () => {
    const node = {
      state: "OPEN",
      headRefOid: "deadbeef",
      baseRefName: "main",
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY",
      commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] },
      reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] },
    };
    expect(parsePullRequestNode("u", node)).toEqual({
      url: "u",
      state: ProviderPrState.Open,
      headSha: "deadbeef",
      mergeable: PrMergeable.Conflicting,
      mergeStateStatus: PrMergeStateStatus.Dirty,
      ciRollup: CiRollupState.Failure,
      unresolvedThreadCount: 2,
      baseBranch: "main",
    });
    expect(parsePullRequestNode("u", { state: "MERGED", commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })).toMatchObject({
      state: ProviderPrState.Merged,
      ciRollup: undefined,
      unresolvedThreadCount: 0,
    });
    expect(parsePullRequestNode("u", null)).toBeUndefined();
    expect(parsePullRequestNode("u", { state: "UNREACHABLE" })).toBeUndefined();
  });

  it("keeps the PRs GitHub answered even when another in the batch errored", () => {
    const partial = { data: { p0: { pullRequest: { state: "OPEN" } }, p1: { pullRequest: null } }, errors: [{ type: "NOT_FOUND" }] };
    const runner = scriptedRunner(() => ({ exitCode: 1, stdout: JSON.stringify(partial) }));
    const statuses = fetchPrLiveStatuses(prs, runner.runCommand);
    expect([...statuses.keys()]).toEqual(["https://github.com/o/r/pull/1"]);
    expect(runner.calls[0].executable).toBe("gh");
  });

  it("splits large sets into batches and survives a batch that failed outright", () => {
    const manyPrs = Array.from({ length: 30 }, (_, index) => ({ repo: "o/r", number: index + 1, url: `https://github.com/o/r/pull/${index + 1}` }));
    let callCount = 0;
    const runner = scriptedRunner(() => {
      callCount++;
      if (callCount === 1) return null;
      return succeeded("not json");
    });
    expect(fetchPrLiveStatuses(manyPrs, runner.runCommand).size).toBe(0);
    expect(runner.calls).toHaveLength(2);
    expect(fetchPrLiveStatuses([], runner.runCommand).size).toBe(0);
  });
});

describe("readMugglePluginUpdatedAtMs", () => {
  function writeInstalled(installs: unknown): string {
    const filePath = join(makeTempDir("plugins"), "installed_plugins.json");
    writeFileSync(filePath, JSON.stringify(installs));
    return filePath;
  }

  const userInstall = { scope: "user", version: "1.0.0", gitCommitSha: "aaa", lastUpdated: "2026-10-24T10:00:00.000Z" };

  it("reports the muggle plugin's newest user-scope update, ignoring project scope and every other plugin", () => {
    const updatedAtMs = readMugglePluginUpdatedAtMs(writeInstalled({
      plugins: {
        [MUGGLE_PLUGIN_ID]: [userInstall, { scope: "project", version: "0.9.0", lastUpdated: "2026-10-25T00:00:00.000Z" }],
        "code-review@claude-plugins-official": [{ ...userInstall, lastUpdated: "2026-10-26T17:31:49.471Z" }],
      },
    }));
    expect(updatedAtMs).toBe(Date.parse("2026-10-24T10:00:00.000Z"));
  });

  it("returns undefined for a missing, shapeless, or undated record, or one without the muggle plugin", () => {
    expect(readMugglePluginUpdatedAtMs(join(makeTempDir("plugins"), "absent.json"))).toBeUndefined();
    expect(readMugglePluginUpdatedAtMs(writeInstalled({ version: 2 }))).toBeUndefined();
    expect(readMugglePluginUpdatedAtMs(writeInstalled({ plugins: { [MUGGLE_PLUGIN_ID]: "not a list" } }))).toBeUndefined();
    expect(readMugglePluginUpdatedAtMs(writeInstalled({ plugins: { [MUGGLE_PLUGIN_ID]: [{ ...userInstall, lastUpdated: "not a date" }] } }))).toBeUndefined();
    expect(readMugglePluginUpdatedAtMs(writeInstalled({ plugins: { "other@market": [userInstall] } }))).toBeUndefined();
  });
});

describe("terminal PR cache", () => {
  const NOW_MS = Date.parse("2026-10-24T12:00:00Z");
  const openPr = { repo: "o/r", number: 1, url: "u1" };
  const mergedPr = { repo: "o/r", number: 2, url: "u2" };
  const stalePr = { repo: "o/r", number: 3, url: "u3" };

  it("skips a recently confirmed terminal PR and rechecks a stale or unreadable entry", () => {
    const cache = {
      u2: { state: ProviderPrState.Merged, checkedAt: "2026-10-24T11:00:00Z" },
      u3: { state: ProviderPrState.Closed, checkedAt: "2026-10-23T00:00:00Z" },
      u1: { state: ProviderPrState.Closed, checkedAt: "garbage" },
    };
    const split = partitionByTerminalCache([openPr, mergedPr, stalePr], cache, NOW_MS);
    expect(split.prsToQuery.map((pr) => pr.url)).toEqual(["u1", "u3"]);
    expect(split.cachedStatuses).toEqual([{ url: "u2", state: ProviderPrState.Merged, unresolvedThreadCount: 0 }]);
  });

  it("adds terminal results, drops reopened PRs, and prunes PRs no slot lists", () => {
    const cache = {
      u1: { state: ProviderPrState.Closed, checkedAt: "x" },
      gone: { state: ProviderPrState.Merged, checkedAt: "x" },
    };
    const next = updateTerminalCache(
      cache,
      [
        { url: "u1", state: ProviderPrState.Open, unresolvedThreadCount: 0 },
        { url: "u2", state: ProviderPrState.Merged, unresolvedThreadCount: 0 },
      ],
      new Set(["u1", "u2"]),
      "2026-10-24T12:00:00Z",
    );
    expect(next).toEqual({ u2: { state: ProviderPrState.Merged, checkedAt: "2026-10-24T12:00:00Z" } });
  });
});
