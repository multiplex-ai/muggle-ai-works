/** Tests for the cross-worktree execution lane. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/logger.js", () => ({
  getLogger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

const HOME_ENV_VAR = os.platform() === "win32" ? "USERPROFILE" : "HOME";
const DEAD_PID = 987654321;

let tempHome: string;
let savedHome: string | undefined;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-lock-test-"));
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

async function loadLaneModule() {
  return await import("../mcp/local/services/local-execution-lock.js");
}

async function loadConstants() {
  return await import("../mcp/local/services/local-execution-lock-constants.js");
}

function laneDirPath(): string {
  return path.join(tempHome, ".muggle-ai", "local-execution-lane");
}

function resolvedCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  return os.platform() === "win32" ? resolved.toLowerCase() : resolved;
}

function writeGeneration(generation: number, record: unknown): void {
  fs.mkdirSync(laneDirPath(), { recursive: true });
  const fileName = `generation-${String(generation).padStart(12, "0")}.json`;
  fs.writeFileSync(path.join(laneDirPath(), fileName), JSON.stringify(record));
}

describe("local execution lane", () => {
  it("holds the lane on acquire and frees it on release", async () => {
    const { acquireLocalExecutionLock, readLocalExecutionLaneStatus } = await loadLaneModule();

    const handle = await acquireLocalExecutionLock({ cwd: "/some/worktree" });
    expect((await readLocalExecutionLaneStatus()).holder?.cwd).toBe(resolvedCwd("/some/worktree"));

    await handle.release();
    const status = await readLocalExecutionLaneStatus();
    expect(status.holder).toBeNull();
    expect(status.freedAt).not.toBeNull();
  });

  it("is reentrant for the same cwd (refcounted)", async () => {
    const { acquireLocalExecutionLock, readLocalExecutionLaneStatus } = await loadLaneModule();

    const handle1 = await acquireLocalExecutionLock({ cwd: "/same/worktree" });
    const handle2 = await acquireLocalExecutionLock({ cwd: "/same/worktree" });
    expect((await readLocalExecutionLaneStatus()).holder?.pids).toHaveLength(2);

    await handle1.release();
    expect((await readLocalExecutionLaneStatus()).holder?.pids).toHaveLength(1);

    await handle2.release();
    expect((await readLocalExecutionLaneStatus()).holder).toBeNull();
  });

  it("answers a different checkout at once with the holder and its place in line", async () => {
    const { acquireLocalExecutionLock, tryAcquireLocalExecutionLane, readLocalExecutionLaneStatus, LaneRelation } =
      await loadLaneModule();

    const firstHandle = await acquireLocalExecutionLock({ cwd: "/worktree/a" });
    const attempt = await tryAcquireLocalExecutionLane({ cwd: "/worktree/b" });

    expect(attempt.granted).toBe(false);
    if (attempt.granted) throw new Error("unreachable");
    expect(attempt.busy.holderCwd).toBe(resolvedCwd("/worktree/a"));
    expect(attempt.busy.position).toBe(1);

    const status = await readLocalExecutionLaneStatus({ cwd: "/worktree/b" });
    expect(status.relation).toBe(LaneRelation.HeldByPeer);
    expect(status.position).toBe(1);

    await firstHandle.release();
  });

  it("makes a waiting checkout run once the holder releases", async () => {
    const { acquireLocalExecutionLock, readLocalExecutionLaneStatus } = await loadLaneModule();

    const firstHandle = await acquireLocalExecutionLock({ cwd: "/worktree/a" });

    let secondAcquired = false;
    const secondAcquirePromise = (async () => {
      const handle = await acquireLocalExecutionLock({ cwd: "/worktree/b" });
      secondAcquired = true;
      return handle;
    })();

    await new Promise((r) => setTimeout(r, 300));
    expect(secondAcquired).toBe(false);

    await firstHandle.release();

    const secondHandle = await secondAcquirePromise;
    expect((await readLocalExecutionLaneStatus()).holder?.cwd).toBe(resolvedCwd("/worktree/b"));
    expect((await readLocalExecutionLaneStatus()).queue).toEqual([]);

    await secondHandle.release();
  });

  it("gives up after the wait the caller allowed, with a busy error", async () => {
    const { acquireLocalExecutionLock, LocalExecutionLaneBusyError } = await loadLaneModule();

    const firstHandle = await acquireLocalExecutionLock({ cwd: "/worktree/a" });
    const startedAt = Date.now();

    const failure = await acquireLocalExecutionLock({ cwd: "/worktree/b", waitMs: 200 }).catch((error) => error);

    expect(failure).toBeInstanceOf(LocalExecutionLaneBusyError);
    expect(failure.busy.holderCwd).toBe(resolvedCwd("/worktree/a"));
    expect(Date.now() - startedAt).toBeLessThan(2000);

    await firstHandle.release();
  });

  it("sweeps a holder whose pids are all dead", async () => {
    const { acquireLocalExecutionLock, readLocalExecutionLaneStatus } = await loadLaneModule();
    writeGeneration(3, {
      holder: { cwd: resolvedCwd("/dead/worktree"), pids: [DEAD_PID], acquiredAt: Date.now() - 60_000 },
      queue: [],
      freedAt: null,
    });

    const handle = await acquireLocalExecutionLock({ cwd: "/fresh/worktree", waitMs: 0 });

    const status = await readLocalExecutionLaneStatus();
    expect(status.holder?.cwd).toBe(resolvedCwd("/fresh/worktree"));
    expect(status.holder?.pids).toEqual([process.pid]);
    expect(status.generation).toBe(4);

    await handle.release();
  });

  it("grants exactly one of many checkouts racing for a free lane", async () => {
    const { tryAcquireLocalExecutionLane, readLocalExecutionLaneStatus } = await loadLaneModule();

    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, index) => tryAcquireLocalExecutionLane({ cwd: `/race/worktree-${index}` })),
    );

    const granted = attempts.filter((attempt) => attempt.granted);
    expect(granted).toHaveLength(1);
    const status = await readLocalExecutionLaneStatus();
    expect(status.queue).toHaveLength(7);

    for (const attempt of granted) if (attempt.granted) await attempt.handle.release();
  });

  it("respects a live holder recorded by a pre-lane server", async () => {
    const { tryAcquireLocalExecutionLane } = await loadLaneModule();
    fs.mkdirSync(path.join(tempHome, ".muggle-ai"), { recursive: true });
    fs.writeFileSync(
      path.join(tempHome, ".muggle-ai", "local-execution.lock"),
      JSON.stringify({ holderCwd: resolvedCwd("/old/server"), holderPids: [process.pid], acquiredAt: Date.now() }),
    );

    const attempt = await tryAcquireLocalExecutionLane({ cwd: "/new/server" });

    expect(attempt.granted).toBe(false);
    if (attempt.granted) throw new Error("unreachable");
    expect(attempt.busy.holderCwd).toBe(resolvedCwd("/old/server"));
    expect(attempt.busy.heldByLegacyServer).toBe(true);
  });

  it("keeps only a bounded tail of generations", async () => {
    const { acquireLocalExecutionLock } = await loadLaneModule();
    const { GENERATIONS_KEPT } = await loadConstants();

    for (let cycle = 0; cycle < 12; cycle++) {
      const handle = await acquireLocalExecutionLock({ cwd: "/churn/worktree" });
      await handle.release();
    }

    const generationFiles = fs.readdirSync(laneDirPath()).filter((name) => name.startsWith("generation-"));
    expect(generationFiles.length).toBeLessThanOrEqual(GENERATIONS_KEPT + 1);
    expect(fs.readdirSync(laneDirPath()).some((name) => name.startsWith(".pending-"))).toBe(false);
  });
});

describe("decideLaneAcquire", () => {
  const alive = () => true;
  const now = 1_000_000_000;

  it("serves the line first come, first served once the lane frees", async () => {
    const { decideLaneAcquire, LaneGrantReason } = await loadLaneModule();
    const record = {
      holder: null,
      queue: [
        { cwd: "/b", pid: 2, enqueuedAt: now - 5_000, lastSeenAt: now - 1_000 },
        { cwd: "/c", pid: 3, enqueuedAt: now - 4_000, lastSeenAt: now - 1_000 },
      ],
      freedAt: now - 500,
    };

    const forC = decideLaneAcquire({ record: record, cwd: "/c", pid: 3, now: now, isAlive: alive });
    expect(forC.granted).toBe(false);
    if (!forC.granted) expect(forC.busy.position).toBe(2);

    const forB = decideLaneAcquire({ record: record, cwd: "/b", pid: 2, now: now, isAlive: alive });
    expect(forB.granted).toBe(true);
    if (forB.granted) {
      expect(forB.reason).toBe(LaneGrantReason.Free);
      expect(forB.next.queue.map((ticket) => ticket.cwd)).toEqual(["/c"]);
    }
  });

  it("lets a later checkout past one that stopped asking once its grace ran out", async () => {
    const { decideLaneAcquire } = await loadLaneModule();
    const { CLAIM_GRACE_MS } = await loadConstants();
    const record = {
      holder: null,
      queue: [{ cwd: "/b", pid: 2, enqueuedAt: now - 120_000, lastSeenAt: now - CLAIM_GRACE_MS - 1 }],
      freedAt: now - CLAIM_GRACE_MS - 1,
    };

    const forC = decideLaneAcquire({ record: record, cwd: "/c", pid: 3, now: now, isAlive: alive });

    expect(forC.granted).toBe(true);
    if (forC.granted) expect(forC.next.queue.map((ticket) => ticket.cwd)).toEqual(["/b"]);
  });

  it("drops a ticket whose checkout stopped asking long ago", async () => {
    const { decideLaneAcquire } = await loadLaneModule();
    const { TICKET_ABANDON_MS } = await loadConstants();
    const record = {
      holder: { cwd: "/a", pids: [1], acquiredAt: now - 60_000 },
      queue: [{ cwd: "/b", pid: 2, enqueuedAt: now - TICKET_ABANDON_MS * 2, lastSeenAt: now - TICKET_ABANDON_MS - 1 }],
      freedAt: null,
    };

    const forC = decideLaneAcquire({ record: record, cwd: "/c", pid: 3, now: now, isAlive: alive });

    expect(forC.granted).toBe(false);
    if (!forC.granted) {
      expect(forC.busy.position).toBe(1);
      expect(forC.next.queue.map((ticket) => ticket.cwd)).toEqual(["/c"]);
    }
  });

  it("re-reads without re-writing while a caller polls a held lane", async () => {
    const { decideLaneAcquire } = await loadLaneModule();
    const record = {
      holder: { cwd: "/a", pids: [1], acquiredAt: now - 60_000 },
      queue: [{ cwd: "/b", pid: 2, enqueuedAt: now - 2_000, lastSeenAt: now - 1_000 }],
      freedAt: null,
    };

    const forB = decideLaneAcquire({ record: record, cwd: "/b", pid: 2, now: now, isAlive: alive });

    expect(forB.next).toEqual(record);
  });
});
