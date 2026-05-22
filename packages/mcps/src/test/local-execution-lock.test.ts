/** Tests for the cross-worktree single-flight lock. */

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

describe("local-execution-lock", () => {
  it("creates the lock file on first acquire and deletes it on release", async () => {
    const { acquireLocalExecutionLock } = await loadLockModule();

    const handle = await acquireLocalExecutionLock({ cwd: "/some/worktree" });
    expect(fs.existsSync(lockFilePath())).toBe(true);

    await handle.release();
    expect(fs.existsSync(lockFilePath())).toBe(false);
  });

  it("is reentrant for the same cwd (refcounted)", async () => {
    const { acquireLocalExecutionLock } = await loadLockModule();

    const handle1 = await acquireLocalExecutionLock({ cwd: "/same/worktree" });
    const handle2 = await acquireLocalExecutionLock({ cwd: "/same/worktree" });

    const state = JSON.parse(fs.readFileSync(lockFilePath(), "utf-8"));
    expect(state.holderPids).toHaveLength(2);

    await handle1.release();
    expect(fs.existsSync(lockFilePath())).toBe(true);

    await handle2.release();
    expect(fs.existsSync(lockFilePath())).toBe(false);
  });

  it("makes a different-cwd caller wait until released", async () => {
    const { acquireLocalExecutionLock } = await loadLockModule();

    const firstHandle = await acquireLocalExecutionLock({ cwd: "/worktree/a" });

    let secondAcquired = false;
    const secondAcquirePromise = (async () => {
      const handle = await acquireLocalExecutionLock({ cwd: "/worktree/b" });
      secondAcquired = true;
      return handle;
    })();

    await new Promise((r) => setTimeout(r, 500));
    expect(secondAcquired).toBe(false);

    await firstHandle.release();

    const secondHandle = await secondAcquirePromise;
    expect(secondAcquired).toBe(true);

    const state = JSON.parse(fs.readFileSync(lockFilePath(), "utf-8"));
    expect(state.holderCwd.toLowerCase()).toBe(path.resolve("/worktree/b").toLowerCase());

    await secondHandle.release();
  });

  it("breaks a stale lock when all holder pids are dead", async () => {
    const { acquireLocalExecutionLock } = await loadLockModule();

    const staleState = {
      holderCwd: path.resolve("/dead/worktree"),
      holderPids: [987654321],
      acquiredAt: Date.now() - 60_000,
    };
    fs.mkdirSync(path.dirname(lockFilePath()), { recursive: true });
    fs.writeFileSync(lockFilePath(), JSON.stringify(staleState));

    const handle = await acquireLocalExecutionLock({ cwd: "/fresh/worktree" });

    const state = JSON.parse(fs.readFileSync(lockFilePath(), "utf-8"));
    expect(state.holderCwd.toLowerCase()).toBe(path.resolve("/fresh/worktree").toLowerCase());
    expect(state.holderPids).toEqual([process.pid]);

    await handle.release();
  });
});
