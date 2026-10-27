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

    expect(await releaseServiceStack({ cwd: "/wt/a", runGit: git })).toBe(true);
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

  it("lets one change run its test cases in parallel under a single lease", async () => {
    const { checkServiceStack, claimServiceStack, readServiceStackStatus, StackCheckVerdict } = await loadStack();
    writeTracking("/wt/a", [{ name: "web", dir: "/wt/a/web", port: 3000, headSha: SHA_A }]);
    await claimServiceStack({ cwd: "/wt/a", needs: [{ port: 3000, runDir: "/wt/a/web" }], runGit: git });

    const parallelChecks = await Promise.all(
      Array.from({ length: 4 }, () =>
        checkServiceStack({
          cwd: "/wt/a",
          port: 3000,
          shouldRenew: true,
          holderPid: process.pid,
          runGit: git,
          readListener: trackedProcessListening,
        }),
      ),
    );

    expect(parallelChecks.map((report) => report.verdict)).toEqual(Array(4).fill(StackCheckVerdict.Valid));
    const leases = (await readServiceStackStatus()).leases;
    expect(leases).toHaveLength(1);
    expect(leases[0].holderPids).toEqual([process.pid]);
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

  it("keeps a lease whose holder lives, however long between runs", async () => {
    const { decideStackClaim } = await loadStack();
    const record = {
      leases: [{ cwd: "/a", needs: [need(3000, "/a", SHA_A)], grantedAt: now - 600_000, lastSeenAt: now - 300_000, holderPids: [4242] }],
      queue: [],
      portFreedAt: {},
    };

    expect(decideStackClaim({ record: record, cwd: "/b", needs: [need(3000, "/b", SHA_B)], now: now, isAlive: alive }).isGranted).toBe(false);
  });

  it("expires a lease nobody renewed and frees its ports", async () => {
    const { decideStackClaim } = await loadStack();
    const { LEASE_TTL_MS } = await loadConstants();
    const record = {
      leases: [{ cwd: "/a", needs: [need(3000, "/a", SHA_A)], grantedAt: now - LEASE_TTL_MS * 2, lastSeenAt: now - LEASE_TTL_MS - 1 }],
      queue: [],
      portFreedAt: {},
    };

    const decision = decideStackClaim({ record: record, cwd: "/b", needs: [need(3000, "/b", SHA_B)], now: now, isAlive: alive });

    expect(decision.isGranted).toBe(true);
    expect(decision.next.leases.map((lease) => lease.cwd)).toEqual(["/b"]);
  });
});
