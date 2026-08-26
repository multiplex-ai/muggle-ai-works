import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "fs";
import { hostname } from "os";
import { LOCK_POLL_INTERVAL_MS } from "../constants.js";
import type { LockHolder } from "./types.js";

/**
 * Whether a process id is still running on this machine.
 *
 * `EPERM` counts as alive: the process exists but belongs to another user, so
 * signalling it is refused rather than the process being absent.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function recordedHolder(lockPath: string): LockHolder | undefined {
  try {
    return JSON.parse(readFileSync(lockPath, "utf-8")) as LockHolder;
  } catch {
    return undefined;
  }
}

// Death, never elapsed time, is what invalidates a lock. A wall-clock expiry
// would break a lock out from under a holder that is merely slow, which is the
// duplicate-processing failure this store exists to prevent. A holder on
// another machine cannot be probed, so its lock is left alone.
function breakLockIfHolderIsDead(lockPath: string): void {
  const holder = recordedHolder(lockPath);
  if (!holder) return;
  if (holder.host !== hostname() || isProcessAlive(holder.pid)) return;
  try {
    unlinkSync(lockPath);
  } catch {
    return;
  }
}

// Synchronous by necessity: the hooks that take this lock run as one-shot CLI
// invocations with no event loop to yield to, so the wait cannot be a promise.
function pauseBetweenAttempts(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_INTERVAL_MS);
}

/**
 * Run `run` while holding an exclusive lock, releasing it even if `run` throws.
 *
 * Returns `undefined` when the lock could not be taken within `waitMs`. The
 * caller decides what that means — the two stores answer it differently, one
 * dropping the write and one retrying — so this never decides for them.
 */
export function withFileLock<T>(lockPath: string, waitMs: number, run: () => T): T | undefined {
  const deadline = Date.now() + waitMs;
  for (;;) {
    let lockFileDescriptor: number;
    try {
      lockFileDescriptor = openSync(lockPath, "wx");
      writeSync(
        lockFileDescriptor,
        JSON.stringify({
          pid: process.pid,
          host: hostname(),
          acquiredAt: new Date().toISOString(),
        }),
      );
    } catch {
      breakLockIfHolderIsDead(lockPath);
      if (Date.now() >= deadline) return undefined;
      pauseBetweenAttempts();
      continue;
    }
    try {
      return run();
    } finally {
      closeSync(lockFileDescriptor);
      try {
        unlinkSync(lockPath);
      } catch {
        // Already gone: a dead-holder sweep removed it. Nothing left to release.
      }
    }
  }
}
