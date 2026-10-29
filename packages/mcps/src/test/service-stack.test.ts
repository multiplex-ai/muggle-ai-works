/** Tests for the local service-stack ledger. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommandRunner } from "../shared/checkout-freshness-types.js";
import type { IPortListener, PortListenerReader } from "../shared/service-stack/port-listener-types.js";

const HOME_ENV_VAR = os.platform() === "win32" ? "USERPROFILE" : "HOME";
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_BASE = "c".repeat(40);

let tempHome: string;
let savedHome: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-stack-test-"));
  savedHome = process.env[HOME_ENV_VAR];
  process.env[HOME_ENV_VAR] = tempHome;
  vi.resetModules();
});

afterEach(() => {
  if (savedHome === undefined) {
    delete process.env[HOME_ENV_VAR];
  } else {
    process.env[HOME_ENV_VAR] = savedHome;
  }
  fs.rmSync(tempHome, { recursive: true, force: true });
});

async function loadStack() {
  return await import("../shared/service-stack/index.js");
}

async function loadConstants() {
  return await import("../shared/service-stack/service-stack-constants.js");
}

function normalized(directory: string): string {
  const resolved = path.resolve(directory);
  return os.platform() === "win32" ? resolved.toLowerCase() : resolved;
}

// Each checkout is its own root; each run directory has the commit the map names.
function fakeGit(headByDir: Record<string, string>): GitCommandRunner {
  return async (args, cwd) => {
    if (args[1] === "--show-toplevel") return cwd;
    if (args[1] === "HEAD") return headByDir[normalized(cwd)] ?? null;
    return null;
  };
}

function writeTracking(source: string, services: Array<{ name: string; dir: string; port: number; headSha: string; pid?: number }>): void {
  const directory = path.join(tempHome, ".muggle-ai", "prepare", "running");
  fs.mkdirSync(directory, { recursive: true });
  const key = source.replace(/[^a-zA-Z0-9]/g, "-");
  fs.writeFileSync(
    path.join(directory, `${key}.json`),
    JSON.stringify({ source: source, services: services.map((service) => ({ pid: process.pid, ...service })) }),
  );
}

const git = fakeGit({
  [normalized("/wt/a/web")]: SHA_A,
  [normalized("/wt/b/web")]: SHA_B,
  [normalized("/base/api")]: SHA_BASE,
});

// The listener on every port, as the platform tool would report it.
function fakeListeners(listenerByPort: Record<number, IPortListener | null>): PortListenerReader {
  return async (port) => ({ isReadable: true, listener: listenerByPort[port] ?? null });
}

const unreadableListeners: PortListenerReader = async () => ({ isReadable: false, listener: null });

const trackedProcessListening = fakeListeners({ 3000: { pid: process.pid, commandLine: "node start.js", ancestorPids: [] } });

describe("claimServiceStack", () => {
  it("grants a free stack with a per-port plan read from prepare's tracking files", async () => {
    const { claimServiceStack, StackClaimVerdict, StackPortAction } = await loadStack();
    writeTracking("/base", [{ name: "api", dir: "/base/api", port: 8080, headSha: SHA_BASE }]);
    writeTracking("/wt/b", [{ name: "web", dir: "/wt/b/web", port: 3000, headSha: SHA_B }]);

    const report = await claimServiceStack({
      cwd: "/wt/a",
      needs: [
        { port: 3000, runDir: "/wt/a/web" },
        { port: 8080, runDir: "/base/api" },
        { port: 4000, runDir: "/base/api" },
      ],
      runGit: git,
    });

    expect(report.verdict).toBe(StackClaimVerdict.Granted);
    expect(report.plan.map((port) => [port.port, port.action])).toEqual([
      [3000, StackPortAction.Restart],
      [8080, StackPortAction.Keep],
      [4000, StackPortAction.Start],
    ]);
  });

  it("shares ports between checkouts that need the same code there", async () => {
    const { claimServiceStack, StackClaimVerdict } = await loadStack();
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 8080, runDir: "/base/api" }], runGit: git });

    const report = await claimServiceStack({ cwd: "/wt/b", needs: [{ port: 8080, runDir: "/base/api" }], runGit: git });

    expect(report.verdict).toBe(StackClaimVerdict.Granted);
    expect(report.sharedWith).toEqual([normalized("/wt/a")]);
  });

  it("answers busy at once, naming the holder and keeping a place in line", async () => {
    const { claimServiceStack, readServiceStackStatus, StackClaimVerdict } = await loadStack();
    await claimServiceStack({ cwd: "/wt/a", label: "agent-a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });

    const startedAt = Date.now();
    const report = await claimServiceStack({ cwd: "/wt/b", needs: [{ port: 3000, runDir: "/wt/b/web" }], runGit: git });

    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(report.verdict).toBe(StackClaimVerdict.Busy);
    expect(report.position).toBe(1);
    expect(report.blockers).toMatchObject([{ port: 3000, blockingLabel: "agent-a", isQueuedAhead: false }]);
    expect((await readServiceStackStatus()).queue.map((ticket) => ticket.cwd)).toEqual([normalized("/wt/b")]);
  });

  it("grants the waiting checkout once the holder releases", async () => {
    const { claimServiceStack, releaseServiceStack, StackClaimVerdict } = await loadStack();
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });
    await claimServiceStack({ cwd: "/wt/b", needs: [{ port: 3000, runDir: "/wt/b/web" }], runGit: git });

    expect((await releaseServiceStack({ cwd: "/wt/a", runGit: git })).isReleased).toBe(true);
    const report = await claimServiceStack({ cwd: "/wt/b", needs: [{ port: 3000, runDir: "/wt/b/web" }], runGit: git });

    expect(report.verdict).toBe(StackClaimVerdict.Granted);
  });

  it("serves three checkouts waiting on one port in the order they asked", async () => {
    const { claimServiceStack, releaseServiceStack, StackClaimVerdict } = await loadStack();
    const fifoGit = fakeGit({
      [normalized("/q/a")]: SHA_A,
      [normalized("/q/b")]: SHA_B,
      [normalized("/q/c")]: SHA_BASE,
    });
    const claim = (cwd: string) => claimServiceStack({ cwd: cwd, needs: [{ port: 3000, runDir: cwd }], runGit: fifoGit });

    expect((await claim("/q/a")).verdict).toBe(StackClaimVerdict.Granted);
    expect((await claim("/q/b")).position).toBe(1);
    expect((await claim("/q/c")).position).toBe(2);

    await releaseServiceStack({ cwd: "/q/a", runGit: fifoGit });
    const cBeforeB = await claim("/q/c");
    expect(cBeforeB.verdict).toBe(StackClaimVerdict.Busy);
    expect(cBeforeB.blockers).toMatchObject([{ blockingCwd: normalized("/q/b"), isQueuedAhead: true }]);
    expect((await claim("/q/b")).verdict).toBe(StackClaimVerdict.Granted);

    await releaseServiceStack({ cwd: "/q/b", runGit: fifoGit });
    expect((await claim("/q/c")).verdict).toBe(StackClaimVerdict.Granted);
  });

  it("ranks a waiting checkout by the open pull request its lookup finds", async () => {
    const { claimServiceStack, readServiceStackStatus } = await loadStack();
    const lookUpPullRequest = async (cwd: string) =>
      cwd === normalized("/wt/b") ? { number: 7, url: "https://github.com/o/r/pull/7", createdAt: 1_000 } : null;
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });

    await claimServiceStack({ cwd: "/wt/b", needs: [{ port: 3000, runDir: "/wt/b/web" }], runGit: git, lookUpPullRequest });

    expect((await readServiceStackStatus()).queue[0].pullRequest).toEqual({
      number: 7,
      url: "https://github.com/o/r/pull/7",
      createdAt: 1_000,
    });
  });

  it("grants exactly one of several checkouts racing for different code on one port", async () => {
    const { claimServiceStack, StackClaimVerdict } = await loadStack();
    const racers = Array.from({ length: 6 }, (_, index) => `/race/${index}`);
    const raceGit = fakeGit(Object.fromEntries(racers.map((racer, index) => [normalized(racer), String(index).repeat(40)])));

    const reports = await Promise.all(
      racers.map((racer) => claimServiceStack({ cwd: racer, needs: [{ port: 3000, runDir: racer }], runGit: raceGit })),
    );

    expect(reports.filter((report) => report.verdict === StackClaimVerdict.Granted)).toHaveLength(1);
  });
});

describe("checkServiceStack", () => {
  it("is valid while the claimed ports serve the claimed code", async () => {
    const { checkServiceStack, claimServiceStack, StackCheckVerdict } = await loadStack();
    writeTracking("/wt/a", [{ name: "web", dir: "/wt/a/web", port: 3000, headSha: SHA_A }]);
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });

    const report = await checkServiceStack({
      cwd: "/wt/a",
      port: 3000,
      runGit: git,
      readListener: trackedProcessListening,
    });

    expect(report.verdict).toBe(StackCheckVerdict.Valid);
    expect(report.servedNeeds).toHaveLength(1);
    expect(report.servedNeeds[0]).toMatchObject({ port: 3000, headSha: SHA_A });
  });

  it("reports nothing served when the checkout holds no lease", async () => {
    const { checkServiceStack, StackCheckVerdict } = await loadStack();

    const report = await checkServiceStack({ cwd: "/wt/a", runGit: git, readListener: unreadableListeners });

    expect(report.verdict).toBe(StackCheckVerdict.NoLease);
    expect(report.servedNeeds).toEqual([]);
  });

  it("is stale when a claimed port now serves other code", async () => {
    const { checkServiceStack, claimServiceStack, StackCheckVerdict, StackMismatchKind } = await loadStack();
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });
    writeTracking("/wt/b", [{ name: "web", dir: "/wt/b/web", port: 3000, headSha: SHA_B }]);

    const report = await checkServiceStack({
      cwd: "/wt/a",
      port: 3000,
      runGit: git,
      readListener: trackedProcessListening,
    });

    expect(report.verdict).toBe(StackCheckVerdict.Stale);
    expect(report.mismatches[0].kind).toBe(StackMismatchKind.OtherCode);
    expect(report.mismatches[0].actual?.dir).toBe(normalized("/wt/b/web"));
  });

  it("is stale when a process prepare never tracked holds a claimed port", async () => {
    const { checkServiceStack, claimServiceStack, StackCheckVerdict, StackMismatchKind, describeStackMismatch } =
      await loadStack();
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });
    const untrackedServer = { pid: 34016, commandLine: "node static_spa_server.cjs /wt/b/build 3000", ancestorPids: [880] };

    const report = await checkServiceStack({
      cwd: "/wt/a",
      port: 3000,
      runGit: git,
      readListener: fakeListeners({ 3000: untrackedServer }),
    });

    expect(report.verdict).toBe(StackCheckVerdict.Stale);
    expect(report.mismatches[0].kind).toBe(StackMismatchKind.UntrackedListener);
    expect(report.mismatches[0].listener).toEqual(untrackedServer);
    expect(describeStackMismatch(report.mismatches[0])).toContain("held by untracked PID 34016 (node static_spa_server.cjs");
  });

  it("is stale when a tracked service is alive but something else holds its port", async () => {
    const { checkServiceStack, claimServiceStack, StackCheckVerdict, StackMismatchKind } = await loadStack();
    writeTracking("/wt/a", [{ name: "web", dir: "/wt/a/web", port: 3000, headSha: SHA_A }]);
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });

    const report = await checkServiceStack({
      cwd: "/wt/a",
      runGit: git,
      readListener: fakeListeners({ 3000: { pid: 34016, commandLine: "", ancestorPids: [880] } }),
    });

    expect(report.verdict).toBe(StackCheckVerdict.Stale);
    expect(report.mismatches[0].kind).toBe(StackMismatchKind.UntrackedListener);
    expect(report.mismatches[0].actual?.pid).toBe(process.pid);
  });

  it("is stale when nothing listens on a claimed port", async () => {
    const { checkServiceStack, claimServiceStack, StackCheckVerdict, StackMismatchKind } = await loadStack();
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });

    const report = await checkServiceStack({ cwd: "/wt/a", runGit: git, readListener: fakeListeners({}) });

    expect(report.verdict).toBe(StackCheckVerdict.Stale);
    expect(report.mismatches[0].kind).toBe(StackMismatchKind.NothingListening);
  });

  it("accepts a listener started by the tracked service, such as the server npm start launches", async () => {
    const { checkServiceStack, claimServiceStack, StackCheckVerdict } = await loadStack();
    writeTracking("/wt/a", [{ name: "web", dir: "/wt/a/web", port: 3000, headSha: SHA_A }]);
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });
    const devServerChild = { pid: 43016, commandLine: "node react-scripts/start.js", ancestorPids: [23248, process.pid] };

    const report = await checkServiceStack({
      cwd: "/wt/a",
      runGit: git,
      readListener: fakeListeners({ 3000: devServerChild }),
    });

    expect(report.verdict).toBe(StackCheckVerdict.Valid);
  });

  it("falls back to tracking alone when the platform cannot say who listens", async () => {
    const { checkServiceStack, claimServiceStack, StackCheckVerdict } = await loadStack();
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });

    const report = await checkServiceStack({ cwd: "/wt/a", runGit: git, readListener: unreadableListeners });

    expect(report.verdict).toBe(StackCheckVerdict.Valid);
  });

  it("refuses a checkout with no claim that targets a peer's leased port", async () => {
    const { checkServiceStack, claimServiceStack, StackCheckVerdict } = await loadStack();
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });

    expect((await checkServiceStack({ cwd: "/wt/b", port: 3000, runGit: git })).verdict).toBe(StackCheckVerdict.PeerLease);
    expect((await checkServiceStack({ cwd: "/wt/b", port: 5173, runGit: git })).verdict).toBe(StackCheckVerdict.NoLease);
  });

  it("never extends the lease it checks", async () => {
    const { checkServiceStack, claimServiceStack, readServiceStackStatus } = await loadStack();
    writeTracking("/wt/a", [{ name: "web", dir: "/wt/a/web", port: 3000, headSha: SHA_A }]);
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });
    const grantedSeenAt = (await readServiceStackStatus()).leases[0].lastSeenAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await checkServiceStack({ cwd: "/wt/a", port: 3000, runGit: git, readListener: trackedProcessListening });

    expect((await readServiceStackStatus()).leases[0].lastSeenAt).toBe(grantedSeenAt);
  });

  it("reports a lease the ledger ended for going unused until its checkout claims again", async () => {
    const { checkServiceStack, claimServiceStack, StackCheckVerdict } = await loadStack();
    const { SERVE_WINDOW_MS } = await loadConstants();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });
      vi.setSystemTime(Date.now() + SERVE_WINDOW_MS + 1);

      const ended = await checkServiceStack({ cwd: "/wt/a", port: 3000, runGit: git, readListener: unreadableListeners });
      expect(ended.verdict).toBe(StackCheckVerdict.Ended);
      expect(ended.reason).toContain("did not serve the claimed code");

      writeTracking("/wt/a", [{ name: "web", dir: "/wt/a/web", port: 3000, headSha: SHA_A }]);
      await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });
      const reclaimed = await checkServiceStack({ cwd: "/wt/a", port: 3000, runGit: git, readListener: unreadableListeners });
      expect(reclaimed.verdict).toBe(StackCheckVerdict.Valid);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a tracked service whose process is gone", async () => {
    const { checkServiceStack, claimServiceStack, StackCheckVerdict } = await loadStack();
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });
    writeTracking("/wt/b", [{ name: "web", dir: "/wt/b/web", port: 3000, headSha: SHA_B, pid: 987654321 }]);

    expect((await checkServiceStack({ cwd: "/wt/a", runGit: git, readListener: unreadableListeners })).verdict).toBe(
      StackCheckVerdict.Valid,
    );
  });
});

describe("decideStackClaim", () => {
  const now = 1_000_000_000;
  const alive = () => true;
  const need = (port: number, runDir: string, headSha: string) => ({ port: port, runDir: runDir, headSha: headSha });

  it("serves a contested port first come, first served", async () => {
    const { decideStackClaim } = await loadStack();
    const record = {
      leases: [],
      queue: [
        { cwd: "/b", needs: [need(3000, "/b", SHA_B)], enqueuedAt: now - 5_000, lastSeenAt: now - 1_000 },
        { cwd: "/c", needs: [need(3000, "/c", SHA_A)], enqueuedAt: now - 4_000, lastSeenAt: now - 1_000 },
      ],
      portFreedAt: { "3000": now - 500 },
    };

    expect(decideStackClaim({ record: record, cwd: "/c", needs: [need(3000, "/c", SHA_A)], now: now, isAlive: alive }).isGranted).toBe(false);
    expect(decideStackClaim({ record: record, cwd: "/b", needs: [need(3000, "/b", SHA_B)], now: now, isAlive: alive }).isGranted).toBe(true);
  });

  it("lets a checkout past one ahead that wants other ports", async () => {
    const { decideStackClaim } = await loadStack();
    const record = {
      leases: [],
      queue: [{ cwd: "/b", needs: [need(3000, "/b", SHA_B)], enqueuedAt: now - 5_000, lastSeenAt: now - 1_000 }],
      portFreedAt: {},
    };

    expect(decideStackClaim({ record: record, cwd: "/c", needs: [need(5173, "/c", SHA_A)], now: now, isAlive: alive }).isGranted).toBe(true);
  });

  it("stops owing a turn to a checkout that stopped asking", async () => {
    const { decideStackClaim } = await loadStack();
    const { CLAIM_GRACE_MS } = await loadConstants();
    const record = {
      leases: [],
      queue: [{ cwd: "/b", needs: [need(3000, "/b", SHA_B)], enqueuedAt: now - 120_000, lastSeenAt: now - CLAIM_GRACE_MS - 1 }],
      portFreedAt: {},
    };

    const decision = decideStackClaim({ record: record, cwd: "/c", needs: [need(3000, "/c", SHA_A)], now: now, isAlive: alive });

    expect(decision.isGranted).toBe(true);
    expect(decision.next.queue.map((ticket) => ticket.cwd)).toEqual(["/b"]);
  });

  it("ends a lease at once when the session holding it has died", async () => {
    const { decideStackClaim } = await loadStack();
    const { DEAD_HOLDER_GRACE_MS } = await loadConstants();
    const isAlive = (pid: number) => pid !== 4242;
    const leaseIdleFor = (idleMs: number) => ({
      leases: [{ cwd: "/a", needs: [need(3000, "/a", SHA_A)], grantedAt: now - 300_000, lastSeenAt: now - idleMs, holderPids: [4242] }],
      queue: [],
      portFreedAt: {},
    });
    const claimB = (idleMs: number) =>
      decideStackClaim({ record: leaseIdleFor(idleMs), cwd: "/b", needs: [need(3000, "/b", SHA_B)], now: now, isAlive: isAlive });

    expect(claimB(DEAD_HOLDER_GRACE_MS + 1).isGranted).toBe(true);
    // Inside the grace a restarted MCP server can still renew it.
    expect(claimB(DEAD_HOLDER_GRACE_MS - 1).isGranted).toBe(false);
  });

  it("ends a lease soon after its last run, though the session holding it lives", async () => {
    const { decideStackClaim } = await loadStack();
    const { IDLE_RELEASE_MS } = await loadConstants();
    const leaseLastRanAgo = (idleMs: number) => ({
      leases: [
        {
          cwd: "/a",
          needs: [need(3000, "/a", SHA_A)],
          grantedAt: now - 600_000,
          lastSeenAt: now - idleMs,
          lastRunEndedAt: now - idleMs,
          holderPids: [4242],
        },
      ],
      queue: [],
      portFreedAt: {},
    });
    const claimB = (idleMs: number) =>
      decideStackClaim({ record: leaseLastRanAgo(idleMs), cwd: "/b", needs: [need(3000, "/b", SHA_B)], now: now, isAlive: alive });

    expect(claimB(IDLE_RELEASE_MS + 1).isGranted).toBe(true);
    // Inside the window: the turn between two runs of one batch.
    expect(claimB(IDLE_RELEASE_MS - 1).isGranted).toBe(false);
  });

  it("keeps a lease while a run is in flight, however long it runs", async () => {
    const { decideStackClaim } = await loadStack();
    const { IDLE_RELEASE_MS, SERVE_WINDOW_MS } = await loadConstants();
    const longAgo = now - SERVE_WINDOW_MS - IDLE_RELEASE_MS;
    const record = {
      leases: [
        {
          cwd: "/a",
          needs: [need(3000, "/a", SHA_A)],
          grantedAt: longAgo,
          lastSeenAt: longAgo,
          lastRunEndedAt: longAgo,
          activeRuns: [{ runId: "run-1", holderPid: 4242, startedAt: longAgo }],
          holderPids: [4242],
        },
      ],
      queue: [],
      portFreedAt: {},
    };

    expect(decideStackClaim({ record: record, cwd: "/b", needs: [need(3000, "/b", SHA_B)], now: now, isAlive: alive }).isGranted).toBe(false);
  });

  it("stops counting a run whose MCP server exited", async () => {
    const { decideStackClaim } = await loadStack();
    const { DEAD_HOLDER_GRACE_MS } = await loadConstants();
    const startedAt = now - DEAD_HOLDER_GRACE_MS - 1;
    const record = {
      leases: [
        {
          cwd: "/a",
          needs: [need(3000, "/a", SHA_A)],
          grantedAt: startedAt,
          lastSeenAt: startedAt,
          activeRuns: [{ runId: "run-1", holderPid: 4242, startedAt: startedAt }],
          holderPids: [4242],
        },
      ],
      queue: [],
      portFreedAt: {},
    };

    const decision = decideStackClaim({
      record: record,
      cwd: "/b",
      needs: [need(3000, "/b", SHA_B)],
      now: now,
      isAlive: (pid) => pid !== 4242,
    });

    expect(decision.isGranted).toBe(true);
  });

  it("ends a grant whose ports never serve the claimed code once the serve window passes, and remembers why", async () => {
    const { decideStackClaim, StackLeaseEndReason } = await loadStack();
    const { SERVE_WINDOW_MS } = await loadConstants();
    const grantedAgo = (ms: number) => ({
      leases: [{ cwd: "/a", label: "agent-a", needs: [need(3000, "/a", SHA_A)], grantedAt: now - ms, lastSeenAt: now - ms }],
      queue: [],
      portFreedAt: {},
    });
    const claimB = (ms: number) =>
      decideStackClaim({ record: grantedAgo(ms), cwd: "/b", needs: [need(3000, "/b", SHA_B)], now: now, isAlive: alive });

    expect(claimB(SERVE_WINDOW_MS - 1).isGranted).toBe(false);
    const decision = claimB(SERVE_WINDOW_MS + 1);
    expect(decision.isGranted).toBe(true);
    expect(decision.next.leases.map((lease) => lease.cwd)).toEqual(["/b"]);
    expect(decision.next.endedLeases).toEqual([
      { cwd: "/a", label: "agent-a", endedAt: now, reason: StackLeaseEndReason.NeverServed },
    ]);
  });

  it("ends a grant whose services came up but saw no run once the first-run window passes", async () => {
    const { decideStackClaim, StackLeaseEndReason } = await loadStack();
    const { FIRST_RUN_WINDOW_MS } = await loadConstants();
    const grantedAt = now - FIRST_RUN_WINDOW_MS - 120_000;
    const record = {
      leases: [{ cwd: "/a", needs: [need(3000, "/a", SHA_A)], grantedAt: grantedAt, lastSeenAt: grantedAt }],
      queue: [],
      portFreedAt: {},
    };
    const claimBWhenServedAgo = (ms: number) =>
      decideStackClaim({
        record: record,
        cwd: "/b",
        needs: [need(3000, "/b", SHA_B)],
        now: now,
        isAlive: alive,
        servedSince: (claimed) => (claimed.headSha === SHA_A ? now - ms : null),
      });

    expect(claimBWhenServedAgo(FIRST_RUN_WINDOW_MS - 1).isGranted).toBe(false);
    const decision = claimBWhenServedAgo(FIRST_RUN_WINDOW_MS + 1);
    expect(decision.isGranted).toBe(true);
    expect(decision.next.endedLeases?.[0].reason).toBe(StackLeaseEndReason.NoRunAfterServed);
  });

  it("counts a port a peer's shared service already served from the grant, not from that service's start", async () => {
    const { decideStackClaim } = await loadStack();
    const { FIRST_RUN_WINDOW_MS } = await loadConstants();
    const grantedAt = now - FIRST_RUN_WINDOW_MS + 1_000;
    const record = {
      leases: [{ cwd: "/a", needs: [need(8080, "/base", SHA_BASE)], grantedAt: grantedAt, lastSeenAt: grantedAt }],
      queue: [],
      portFreedAt: {},
    };

    const decision = decideStackClaim({
      record: record,
      cwd: "/b",
      needs: [need(8080, "/b", SHA_B)],
      now: now,
      isAlive: alive,
      servedSince: () => now - 60 * 60_000,
    });

    expect(decision.isGranted).toBe(false);
  });

  it("keeps a lease an older MCP server renews mid-run, though it records no runs", async () => {
    const { decideStackClaim } = await loadStack();
    const { SERVE_WINDOW_MS } = await loadConstants();
    const record = {
      leases: [{ cwd: "/a", needs: [need(3000, "/a", SHA_A)], grantedAt: now - SERVE_WINDOW_MS * 2, lastSeenAt: now - 60_000, holderPids: [4242] }],
      queue: [],
      portFreedAt: {},
    };

    expect(decideStackClaim({ record: record, cwd: "/b", needs: [need(3000, "/b", SHA_B)], now: now, isAlive: alive }).isGranted).toBe(false);
  });

  it("serves open pull requests oldest first, then checkouts without one in the order they asked", async () => {
    const { decideStackClaim } = await loadStack();
    const pullRequest = (number: number, openedAgoMs: number) => ({ number: number, url: "", createdAt: now - openedAgoMs });
    const record = {
      leases: [{ cwd: "/holder", needs: [need(3000, "/holder", SHA_BASE)], grantedAt: now - 1_000, lastSeenAt: now - 1_000 }],
      queue: [
        { cwd: "/no-pr", needs: [need(3000, "/no-pr", SHA_A)], enqueuedAt: now - 9_000, lastSeenAt: now - 1_000 },
        { cwd: "/new-pr", needs: [need(3000, "/new-pr", SHA_A)], pullRequest: pullRequest(12, 60_000), enqueuedAt: now - 8_000, lastSeenAt: now - 1_000 },
      ],
      portFreedAt: {},
    };

    const decision = decideStackClaim({
      record: record,
      cwd: "/old-pr",
      needs: [need(3000, "/old-pr", SHA_B)],
      pullRequest: pullRequest(7, 3_600_000),
      now: now,
      isAlive: alive,
    });

    expect(decision.position).toBe(1);
    expect(decision.next.queue.map((ticket) => ticket.cwd)).toEqual(["/old-pr", "/new-pr", "/no-pr"]);
  });

  it("keeps the ask order of checkouts that first asked in the same millisecond when one asks again", async () => {
    const { decideStackClaim } = await loadStack();
    const record = {
      leases: [{ cwd: "/holder", needs: [need(3000, "/holder", SHA_BASE)], grantedAt: now - 1_000, lastSeenAt: now - 1_000 }],
      queue: [
        { cwd: "/b", needs: [need(3000, "/b", SHA_B)], enqueuedAt: now - 5_000, lastSeenAt: now - 1_000 },
        { cwd: "/c", needs: [need(3000, "/c", SHA_A)], enqueuedAt: now - 5_000, lastSeenAt: now - 1_000 },
      ],
      portFreedAt: {},
    };

    const reasked = decideStackClaim({ record: record, cwd: "/b", needs: [need(3000, "/b", SHA_B)], now: now, isAlive: alive });

    expect(reasked.position).toBe(1);
    expect(reasked.next.queue.map((ticket) => ticket.cwd)).toEqual(["/b", "/c"]);
  });

  it("puts a re-run of an older pull request back ahead of newer ones, whenever it asks again", async () => {
    const { decideStackClaim } = await loadStack();
    const olderPullRequest = { number: 7, url: "", createdAt: now - 3_600_000 };
    const record = {
      leases: [{ cwd: "/holder", needs: [need(3000, "/holder", SHA_BASE)], grantedAt: now - 1_000, lastSeenAt: now - 1_000 }],
      queue: [
        {
          cwd: "/new-pr",
          needs: [need(3000, "/new-pr", SHA_A)],
          pullRequest: { number: 12, url: "", createdAt: now - 60_000 },
          enqueuedAt: now - 600_000,
          lastSeenAt: now - 1_000,
        },
      ],
      portFreedAt: {},
    };

    const rerun = decideStackClaim({
      record: record,
      cwd: "/old-pr",
      needs: [need(3000, "/old-pr", SHA_B)],
      pullRequest: olderPullRequest,
      now: now,
      isAlive: alive,
    });
    const afterLookupFailed = decideStackClaim({
      record: rerun.next,
      cwd: "/old-pr",
      needs: [need(3000, "/old-pr", SHA_B)],
      pullRequest: null,
      now: now + 1_000,
      isAlive: alive,
    });

    expect(rerun.position).toBe(1);
    expect(afterLookupFailed.position).toBe(1);
  });

  it("does not extend a lease its holder re-claims", async () => {
    const { decideStackClaim, decideStackReap } = await loadStack();
    const { SERVE_WINDOW_MS } = await loadConstants();
    const grantedAt = now - SERVE_WINDOW_MS + 60_000;
    const record = {
      leases: [{ cwd: "/a", needs: [need(3000, "/a", SHA_A)], grantedAt: grantedAt, lastSeenAt: grantedAt }],
      queue: [],
      portFreedAt: {},
    };

    const reclaimed = decideStackClaim({ record: record, cwd: "/a", needs: [need(3000, "/a", SHA_A)], now: now, isAlive: alive });

    expect(reclaimed.isGranted).toBe(true);
    expect(reclaimed.next.leases[0]).toMatchObject({ grantedAt: grantedAt, lastSeenAt: grantedAt });
    expect(decideStackReap({ record: reclaimed.next, now: now + 60_001, isAlive: alive })?.leases).toEqual([]);
  });
});

describe("decideStackRunStart and decideStackRunEnd", () => {
  const now = 1_000_000_000;
  const alive = () => true;
  const granted = {
    leases: [{ cwd: "/a", needs: [{ port: 3000, runDir: "/a", headSha: SHA_A }], grantedAt: now - 1_000, lastSeenAt: now - 1_000 }],
    queue: [],
    portFreedAt: {},
  };

  it("holds the lease from a run's start until the idle window after its end", async () => {
    const { decideStackReap, decideStackRunEnd, decideStackRunStart } = await loadStack();
    const { IDLE_RELEASE_MS } = await loadConstants();

    const running = decideStackRunStart({ record: granted, cwd: "/a", runId: "run-1", holderPid: 4242, now: now, isAlive: alive });
    expect(running?.leases[0]).toMatchObject({ activeRuns: [{ runId: "run-1", holderPid: 4242 }], holderPids: [4242] });

    const ended = decideStackRunEnd({ record: running!, cwd: "/a", runId: "run-1", now: now + 5_000, isAlive: alive });
    expect(ended?.leases[0].activeRuns).toBeUndefined();
    expect(ended?.leases[0].lastRunEndedAt).toBe(now + 5_000);

    expect(decideStackReap({ record: ended!, now: now + 5_000 + IDLE_RELEASE_MS - 1, isAlive: alive })).toBeNull();
    expect(decideStackReap({ record: ended!, now: now + 5_000 + IDLE_RELEASE_MS + 1, isAlive: alive })?.leases).toEqual([]);
  });

  it("keeps the lease while a parallel run is still in flight", async () => {
    const { decideStackReap, decideStackRunEnd, decideStackRunStart } = await loadStack();
    const { IDLE_RELEASE_MS } = await loadConstants();

    const first = decideStackRunStart({ record: granted, cwd: "/a", runId: "run-1", holderPid: 4242, now: now, isAlive: alive });
    const both = decideStackRunStart({ record: first!, cwd: "/a", runId: "run-2", holderPid: 4242, now: now, isAlive: alive });
    const oneLeft = decideStackRunEnd({ record: both!, cwd: "/a", runId: "run-1", now: now + 1_000, isAlive: alive });

    expect(both?.leases[0].holderPids).toEqual([4242]);
    expect(oneLeft?.leases[0].activeRuns?.map((run) => run.runId)).toEqual(["run-2"]);
    expect(decideStackReap({ record: oneLeft!, now: now + IDLE_RELEASE_MS * 10, isAlive: alive })).toBeNull();
  });
});

describe("findVacatedNeeds", () => {
  const leaseOf = (cwd: string, ...needs: Array<{ port: number; runDir: string; headSha: string }>) => ({
    cwd: cwd,
    needs: needs,
    grantedAt: 0,
    lastSeenAt: 0,
  });
  const web = { port: 3000, runDir: "/a/web", headSha: SHA_A };
  const api = { port: 8080, runDir: "/base/api", headSha: SHA_BASE };

  it("names the code a dropped lease needed and no remaining lease does", async () => {
    const { findVacatedNeeds } = await loadStack();

    const vacated = findVacatedNeeds({
      before: { leases: [leaseOf("/a", web, api), leaseOf("/b", api)], queue: [], portFreedAt: {} },
      after: { leases: [leaseOf("/b", api)], queue: [], portFreedAt: {} },
    });

    expect(vacated).toEqual([web]);
  });

  it("names the old code when a holder re-claims a port at a new commit", async () => {
    const { findVacatedNeeds } = await loadStack();
    const newWeb = { ...web, headSha: SHA_B };

    const vacated = findVacatedNeeds({
      before: { leases: [leaseOf("/a", web)], queue: [], portFreedAt: {} },
      after: { leases: [leaseOf("/a", newWeb)], queue: [], portFreedAt: {} },
    });

    expect(vacated).toEqual([web]);
  });
});

describe("stopVacatedServices", () => {
  const vacatedWeb = { port: 3000, runDir: normalized("/wt/a/web"), headSha: SHA_A };
  const trackedWeb = {
    name: "web",
    dir: normalized("/wt/a/web"),
    port: 3000,
    pid: 5100,
    headSha: SHA_A,
    source: normalized("/wt/a"),
    isExternal: false,
  };
  const devServerChild = { pid: 5102, commandLine: "node react-scripts/start.js", ancestorPids: [5101, 5100] };

  async function stopWith(params: {
    services?: Array<typeof trackedWeb>;
    listener: IPortListener | null;
    remainingLeases?: Array<{ cwd: string; needs: Array<typeof vacatedWeb>; grantedAt: number; lastSeenAt: number }>;
  }) {
    const { stopVacatedServices } = await loadStack();
    const stopped: number[] = [];
    const report = await stopVacatedServices({
      vacatedNeeds: [vacatedWeb],
      remainingLeases: params.remainingLeases ?? [],
      services: params.services ?? [],
      readListener: fakeListeners({ 3000: params.listener }),
      stopProcessTree: async (pid) => {
        stopped.push(pid);
      },
    });
    return { report: report, stopped: stopped };
  }

  it("stops the tracked service's whole tree, launcher included", async () => {
    const { report, stopped } = await stopWith({ services: [trackedWeb], listener: devServerChild });

    expect(stopped).toEqual([5100]);
    expect(report).toEqual([{ port: 3000, pid: 5100, name: "web", commandLine: "node react-scripts/start.js" }]);
  });

  it("stops an untracked listener alone, never its parents", async () => {
    const { stopped } = await stopWith({ listener: devServerChild });

    expect(stopped).toEqual([5102]);
  });

  it("never stops a service the user started", async () => {
    const { stopped } = await stopWith({ services: [{ ...trackedWeb, isExternal: true }], listener: devServerChild });

    expect(stopped).toEqual([]);
  });

  it("leaves a service a remaining lease still needs", async () => {
    const { stopped } = await stopWith({
      services: [trackedWeb],
      listener: devServerChild,
      remainingLeases: [{ cwd: "/wt/b", needs: [vacatedWeb], grantedAt: 0, lastSeenAt: 0 }],
    });

    expect(stopped).toEqual([]);
  });

  it("stops nothing on a port nobody listens on", async () => {
    const { report, stopped } = await stopWith({ services: [trackedWeb], listener: null });

    expect(stopped).toEqual([]);
    expect(report).toEqual([]);
  });

  it("never stops its own process", async () => {
    const { stopped } = await stopWith({ listener: { pid: process.pid, commandLine: "node mcp", ancestorPids: [] } });

    expect(stopped).toEqual([]);
  });
});

describe("releaseServiceStack", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("../shared/service-stack/port-listener.js");
    vi.doUnmock("../shared/service-stack/process-tree-stopper.js");
  });

  it("stops the services the released lease ran, and reports them", async () => {
    const stoppedPids: number[] = [];
    vi.doMock("../shared/service-stack/port-listener.js", () => ({
      readPortListener: async () => ({ isReadable: true, listener: { pid: 6200, commandLine: "node serve build 3000", ancestorPids: [] } }),
    }));
    vi.doMock("../shared/service-stack/process-tree-stopper.js", () => ({
      stopProcessTree: async (pid: number) => {
        stoppedPids.push(pid);
      },
    }));
    vi.stubEnv("MUGGLE_STACK_SERVICE_STOPS", "on");
    const { claimServiceStack, releaseServiceStack } = await loadStack();
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });

    const report = await releaseServiceStack({ cwd: "/wt/a", runGit: git });

    expect(report.isReleased).toBe(true);
    expect(stoppedPids).toEqual([6200]);
    expect(report.stoppedServices).toMatchObject([{ port: 3000, pid: 6200, name: null }]);
  });

  it("stops nothing while the test config turns stops off", async () => {
    const { claimServiceStack, releaseServiceStack } = await loadStack();
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });

    expect((await releaseServiceStack({ cwd: "/wt/a", runGit: git })).stoppedServices).toEqual([]);
  });
});
