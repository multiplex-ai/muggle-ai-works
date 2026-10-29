/** Tests for the cross-worktree single-flight lock. */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ICheckoutPullRequest } from "../shared/queue-priority/queue-priority-types.js";

vi.mock("../shared/logger.js", () => ({
  getLogger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

// Waiters poll fast so a test of the line's order takes milliseconds.
vi.mock("../mcp/local/services/local-execution-lock-constants.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../mcp/local/services/local-execution-lock-constants.js")>()),
  POLL_INTERVAL_MS: 20,
  WAITER_ABANDON_MS: 2_000,
}));

const HOME_ENV_VAR = os.platform() === "win32" ? "USERPROFILE" : "HOME";
const RUN_TIMEOUT_MS = 60_000;
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

async function loadLockModule() {
  return await import("../mcp/local/services/local-execution-lock.js");
}

function lockFilePath(): string {
  return path.join(tempHome, ".muggle-ai", "local-execution.lock");
}

function normalized(cwd: string): string {
  const resolved = path.resolve(cwd);
  return os.platform() === "win32" ? resolved.toLowerCase() : resolved;
}

// A waiter still polling in this process may be mid-write: the lock truncates before it writes, and only
// its own readers wait out a write under the modify-lock. A test reading beside them retries a torn read.
async function readLockFile() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return JSON.parse(fs.readFileSync(lockFilePath(), "utf-8"));
    } catch (error) {
      if (!(error instanceof SyntaxError) || attempt >= 50) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
}

function writeLockFile(state: unknown): void {
  fs.mkdirSync(path.dirname(lockFilePath()), { recursive: true });
  fs.writeFileSync(lockFilePath(), JSON.stringify(state));
}

function pullRequestOpenedAt(createdAt: number): ICheckoutPullRequest {
  return { number: createdAt, url: "", createdAt: createdAt };
}

async function acquire(cwd: string, pullRequest: ICheckoutPullRequest | null = null) {
  const { acquireLocalExecutionLock } = await loadLockModule();
  return await acquireLocalExecutionLock({
    cwd: cwd,
    runTimeoutMs: RUN_TIMEOUT_MS,
    lookUpPullRequest: async () => pullRequest,
  });
}

async function waitForWaiters(count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (((await readLockFile()).waiters ?? []).length < count) {
    if (Date.now() > deadline) throw new Error(`never saw ${count} waiters`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("local-execution-lock", () => {
  it("creates the lock file on first acquire and deletes it on release", async () => {
    const handle = await acquire("/some/worktree");
    expect(fs.existsSync(lockFilePath())).toBe(true);

    await handle.release();
    expect(fs.existsSync(lockFilePath())).toBe(false);
  });

  it("is reentrant for the same cwd (refcounted)", async () => {
    const handle1 = await acquire("/same/worktree");
    const handle2 = await acquire("/same/worktree");

    expect((await readLockFile()).holderPids).toHaveLength(2);

    await handle1.release();
    expect(fs.existsSync(lockFilePath())).toBe(true);

    await handle2.release();
    expect(fs.existsSync(lockFilePath())).toBe(false);
  });

  it("makes a different-cwd caller wait until released", async () => {
    const firstHandle = await acquire("/worktree/a");

    let secondAcquired = false;
    const secondAcquirePromise = (async () => {
      const handle = await acquire("/worktree/b");
      secondAcquired = true;
      return handle;
    })();

    await new Promise((r) => setTimeout(r, 500));
    expect(secondAcquired).toBe(false);

    await firstHandle.release();

    const secondHandle = await secondAcquirePromise;
    expect(secondAcquired).toBe(true);
    expect((await readLockFile()).holderCwd).toBe(normalized("/worktree/b"));

    await secondHandle.release();
  });

  it("breaks a stale lock when all holder pids are dead", async () => {
    writeLockFile({ holderCwd: path.resolve("/dead/worktree"), holderPids: [DEAD_PID], acquiredAt: Date.now() - 60_000 });

    const handle = await acquire("/fresh/worktree");

    const state = await readLockFile();
    expect(state.holderCwd).toBe(normalized("/fresh/worktree"));
    expect(state.holderPids).toEqual([process.pid]);

    await handle.release();
  });

  it("passes over a live holder that outran its run timeout", async () => {
    writeLockFile({
      holderCwd: normalized("/stuck/worktree"),
      holderPids: [process.pid],
      acquiredAt: Date.now() - 60 * 60_000,
      holdDeadlineAt: Date.now() - 1,
    });

    const handle = await acquire("/fresh/worktree");

    expect((await readLockFile()).holderCwd).toBe(normalized("/fresh/worktree"));
    await handle.release();
  });

  it("records a deadline of the run's timeout plus the overrun grace", async () => {
    const { HOLD_OVERRUN_GRACE_MS } = await import("../mcp/local/services/local-execution-lock-constants.js");
    const before = Date.now();

    const handle = await acquire("/some/worktree");

    expect((await readLockFile()).holdDeadlineAt).toBeGreaterThanOrEqual(before + RUN_TIMEOUT_MS + HOLD_OVERRUN_GRACE_MS);
    await handle.release();
  });

  it("serves the oldest open pull request first, whatever order the waiters asked in", async () => {
    const holder = await acquire("/worktree/holder");
    const served: string[] = [];
    const waitFor = (cwd: string, pullRequest: ICheckoutPullRequest | null) =>
      acquire(cwd, pullRequest).then((handle) => {
        served.push(cwd);
        return handle;
      });

    const noPullRequest = waitFor("/worktree/no-pr", null);
    await waitForWaiters(1);
    const newerPullRequest = waitFor("/worktree/newer", pullRequestOpenedAt(2_000));
    await waitForWaiters(2);
    const olderPullRequest = waitFor("/worktree/older", pullRequestOpenedAt(1_000));
    await waitForWaiters(3);

    await holder.release();
    await (await olderPullRequest).release();
    await (await newerPullRequest).release();
    await (await noPullRequest).release();

    expect(served).toEqual(["/worktree/older", "/worktree/newer", "/worktree/no-pr"]);
  });

  it("holds a same-checkout join back while another checkout waits ahead of it", async () => {
    const first = await acquire("/worktree/a", pullRequestOpenedAt(5_000));
    const ahead = acquire("/worktree/b", pullRequestOpenedAt(1_000));
    await waitForWaiters(1);

    let isJoined = false;
    const join = acquire("/worktree/a", pullRequestOpenedAt(5_000)).then((handle) => {
      isJoined = true;
      return handle;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(isJoined).toBe(false);

    await first.release();
    const aheadHandle = await ahead;
    expect((await readLockFile()).holderCwd).toBe(normalized("/worktree/b"));
    await aheadHandle.release();
    await (await join).release();
  });

  it("keeps the waiting line when the last holder releases", async () => {
    const holder = await acquire("/worktree/a");
    const waiter = { cwd: normalized("/worktree/b"), pid: process.pid, enqueuedAt: Date.now(), lastPolledAt: Date.now() };
    writeLockFile({ ...(await readLockFile()), waiters: [waiter] });

    await holder.release();

    expect(await readLockFile()).toMatchObject({ holderPids: [], waiters: [waiter] });
  });

  it("drops waiters that exited or stopped polling", async () => {
    const pullRequest = pullRequestOpenedAt(1_000);
    writeLockFile({
      holderCwd: "",
      holderPids: [],
      acquiredAt: 0,
      waiters: [
        { cwd: normalized("/worktree/exited"), pid: DEAD_PID, pullRequest: pullRequest, enqueuedAt: 0, lastPolledAt: Date.now() },
        { cwd: normalized("/worktree/silent"), pid: process.pid, pullRequest: pullRequest, enqueuedAt: 0, lastPolledAt: Date.now() - 60_000 },
      ],
    });

    const handle = await acquire("/worktree/fresh");

    const state = await readLockFile();
    expect(state.holderCwd).toBe(normalized("/worktree/fresh"));
    expect(state.waiters).toEqual([]);
    await handle.release();
  });
});
