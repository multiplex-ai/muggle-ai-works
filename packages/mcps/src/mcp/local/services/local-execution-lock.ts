/**
 * Cross-process single-flight lock for local Electron execution.
 *
 * Serializes muggle-test runs across worktrees so a second invocation from a
 * different branch waits for the first to finish. Within one worktree the lock
 * is reentrant — multiple parallel calls from the same `cwd` share it via a
 * pid list and refcount.
 *
 * Key identity = caller's absolute cwd. A "change" = a worktree path.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { getDataDir } from "../../../shared/data-dir.js";
import { getLogger } from "../../../shared/logger.js";

const LOCK_FILE_NAME = "local-execution.lock";
const MODIFY_LOCK_SUFFIX = ".modify";
const POLL_INTERVAL_MS = 2000;
const WAIT_LOG_INTERVAL_MS = 10_000;
const MODIFY_LOCK_RETRY_MS = 50;
/** Stale modify-lock threshold. If the sidecar persists past this, assume crash. */
const MODIFY_LOCK_STALE_MS = 5_000;

interface ILockState {
  /** Absolute cwd of the worktree that holds the lock. */
  holderCwd: string;
  /** Process IDs currently holding the lock. Multiple entries = same-cwd reentrant holders. */
  holderPids: number[];
  /** Acquisition timestamp (ms since epoch). For diagnostics only. */
  acquiredAt: number;
}

export interface ILocalExecutionLockHandle {
  /** Release the lock. Safe to call once per acquire. */
  release: () => Promise<void>;
}

function lockFilePath(): string {
  return path.join(getDataDir(), LOCK_FILE_NAME);
}

function modifyLockPath(): string {
  return lockFilePath() + MODIFY_LOCK_SUFFIX;
}

/**
 * Normalize a path for cross-process equality. Case-insensitive on Windows so
 * `C:\Users\foo` and `c:\users\foo` map to the same holder.
 */
function normalizeCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  return os.platform() === "win32" ? resolved.toLowerCase() : resolved;
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return false;
  }
}

async function readState(): Promise<ILockState | null> {
  try {
    const raw = await fs.readFile(lockFilePath(), "utf-8");
    return JSON.parse(raw) as ILockState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeState(state: ILockState): Promise<void> {
  await fs.writeFile(lockFilePath(), JSON.stringify(state, null, 2), "utf-8");
}

async function deleteStateFile(): Promise<void> {
  try {
    await fs.unlink(lockFilePath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Hold the modify-lock sidecar for the duration of `fn`. Sidecar is an atomic
 * `wx` create against `local-execution.lock.modify`. Held only across small
 * read-modify-write operations (microseconds-to-milliseconds), so contention
 * is rare.
 */
async function withModifyLock<T>(fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(path.dirname(modifyLockPath()), { recursive: true });
  const modifyPath = modifyLockPath();
  let fileHandle: fs.FileHandle | null = null;

  while (fileHandle === null) {
    try {
      fileHandle = await fs.open(modifyPath, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Try to clean up a stale modify-lock left by a crashed acquirer.
      try {
        const stat = await fs.stat(modifyPath);
        if (Date.now() - stat.mtimeMs > MODIFY_LOCK_STALE_MS) {
          await fs.unlink(modifyPath).catch(() => undefined);
          continue;
        }
      } catch {
        // stat or unlink race — retry
      }
      await new Promise((r) => setTimeout(r, MODIFY_LOCK_RETRY_MS));
    }
  }

  try {
    await fileHandle.writeFile(JSON.stringify({ pid: process.pid, ts: Date.now() }));
    return await fn();
  } finally {
    await fileHandle.close().catch(() => undefined);
    await fs.unlink(modifyPath).catch(() => undefined);
  }
}

interface ITryAcquireOutcome {
  acquired: boolean;
  blockingState?: ILockState;
}

async function tryAcquireOnce(params: { normalizedCwd: string; pid: number }): Promise<ITryAcquireOutcome> {
  return await withModifyLock(async (): Promise<ITryAcquireOutcome> => {
    const existing = await readState();

    if (existing === null) {
      await writeState({
        holderCwd: params.normalizedCwd,
        holderPids: [params.pid],
        acquiredAt: Date.now(),
      });
      return { acquired: true };
    }

    const liveHolderPids = existing.holderPids.filter((pid) => pidIsAlive(pid));

    if (liveHolderPids.length === 0) {
      getLogger().warn("Breaking stale local-execution lock", {
        staleCwd: existing.holderCwd,
        stalePids: existing.holderPids,
      });
      await writeState({
        holderCwd: params.normalizedCwd,
        holderPids: [params.pid],
        acquiredAt: Date.now(),
      });
      return { acquired: true };
    }

    if (existing.holderCwd === params.normalizedCwd) {
      const updated: ILockState = {
        holderCwd: existing.holderCwd,
        holderPids: [...liveHolderPids, params.pid],
        acquiredAt: existing.acquiredAt,
      };
      await writeState(updated);
      return { acquired: true };
    }

    return {
      acquired: false,
      blockingState: { ...existing, holderPids: liveHolderPids },
    };
  });
}

async function decrementHolder(params: { normalizedCwd: string; pid: number }): Promise<void> {
  await withModifyLock(async () => {
    const existing = await readState();
    if (existing === null) return;

    if (existing.holderCwd !== params.normalizedCwd) {
      getLogger().warn("Release skipped — holder cwd no longer matches", {
        ourCwd: params.normalizedCwd,
        holderCwd: existing.holderCwd,
      });
      return;
    }

    const removalIndex = existing.holderPids.indexOf(params.pid);
    const remainingPids =
      removalIndex >= 0
        ? [...existing.holderPids.slice(0, removalIndex), ...existing.holderPids.slice(removalIndex + 1)]
        : existing.holderPids;

    if (remainingPids.length === 0) {
      await deleteStateFile();
      return;
    }

    await writeState({
      holderCwd: existing.holderCwd,
      holderPids: remainingPids,
      acquiredAt: existing.acquiredAt,
    });
  });
}

/**
 * Acquire the local-execution lock. Resolves when the caller may proceed.
 *
 * Same `cwd` as the current holder → reentrant, returns immediately.
 * Different `cwd` → polls every {@link POLL_INTERVAL_MS}ms until the holder releases.
 * Dead holder pids → break-and-take-over (assumes crash).
 *
 * Logs a "waiting for ..." line every {@link WAIT_LOG_INTERVAL_MS}ms while blocked.
 */
export async function acquireLocalExecutionLock(params: { cwd: string }): Promise<ILocalExecutionLockHandle> {
  const normalizedCwd = normalizeCwd(params.cwd);
  const pid = process.pid;

  const startWaitAt = Date.now();
  let lastWaitLogAt = 0;

  while (true) {
    const outcome = await tryAcquireOnce({ normalizedCwd, pid });
    if (outcome.acquired) {
      return {
        release: () => decrementHolder({ normalizedCwd, pid }),
      };
    }

    const now = Date.now();
    if (now - lastWaitLogAt >= WAIT_LOG_INTERVAL_MS) {
      const waitedSec = Math.round((now - startWaitAt) / 1000);
      getLogger().info("Waiting for local-execution lock", {
        ourCwd: normalizedCwd,
        heldBy: outcome.blockingState?.holderCwd,
        heldByPids: outcome.blockingState?.holderPids,
        waitedSec: waitedSec,
      });
      lastWaitLogAt = now;
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

/** Read the current lock state without modifying it. Returns null if unheld. */
export async function readLocalExecutionLockState(): Promise<ILockState | null> {
  return readState();
}
