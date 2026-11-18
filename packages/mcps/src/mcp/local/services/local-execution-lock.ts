/**
 * Cross-process single-flight lock for local Electron execution.
 *
 * Serializes muggle-test runs across worktrees so a second invocation from a
 * different branch waits for the first to finish. Within one worktree the lock
 * is reentrant — multiple parallel calls from the same `cwd` share it via a
 * pid list and refcount.
 *
 * Waiting callers form a line served oldest open pull request first, then in
 * the order they asked; a waiter that stops polling or exits loses its place.
 * A holder past its run's timeout and grace is taken as stuck and passed over,
 * so no live but unresponsive process holds every other session back.
 *
 * A run whose Studio waits for its session stops counting until Studio holds
 * it, so another run may start meanwhile.
 *
 * Key identity = caller's absolute cwd. A "change" = a worktree path.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { getDataDir } from "../../../shared/data-dir.js";
import { getLogger } from "../../../shared/logger.js";
import { lookUpCheckoutPullRequest } from "../../../shared/queue-priority/pull-request-lookup.js";
import { compareQueuePlaces } from "../../../shared/queue-priority/queue-priority.js";
import type {
  PullRequestLookup,
  StudioJobPriorityEnum,
} from "../../../shared/queue-priority/queue-priority-types.js";
import {
  HOLD_OVERRUN_GRACE_MS,
  LOCK_FILE_NAME,
  MODIFY_LOCK_RETRY_MS,
  MODIFY_LOCK_STALE_MS,
  MODIFY_LOCK_SUFFIX,
  POLL_INTERVAL_MS,
  WAIT_LOG_INTERVAL_MS,
  WAITER_ABANDON_MS,
} from "./local-execution-lock-constants.js";
import {
  type ILocalExecutionLockHandle,
  type ILockResumedHolder,
  type ILockState,
  type ILockWaiter,
  type ITryAcquireOutcome,
  LockHoldStateEnum,
} from "./local-execution-lock-types.js";

export type { ILocalExecutionLockHandle, ILockState } from "./local-execution-lock-types.js";

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

/**
 * One attempt, under the modify-lock. The caller takes the lock when no other
 * checkout holds it and no other checkout's waiter ranks ahead; otherwise it
 * records its place in line and is told who blocks it.
 */
async function tryAcquireOnce(params: { caller: ILockWaiter; holdLimitMs: number }): Promise<ITryAcquireOutcome> {
  return await withModifyLock(async (): Promise<ITryAcquireOutcome> => {
    const now = Date.now();
    const existing = await readState();
    const isCaller = (waiter: ILockWaiter) => waiter.cwd === params.caller.cwd && waiter.pid === params.caller.pid;
    const previousPlace = existing?.waiters?.find(isCaller);
    const caller: ILockWaiter = {
      ...params.caller,
      enqueuedAt: Math.min(params.caller.enqueuedAt, previousPlace?.enqueuedAt ?? Number.POSITIVE_INFINITY),
      lastPolledAt: now,
    };
    const otherWaiters = (existing?.waiters ?? []).filter(
      (waiter) => !isCaller(waiter) && pidIsAlive(waiter.pid) && now - waiter.lastPolledAt <= WAITER_ABANDON_MS,
    );
    const holderPids = existing === null ? [] : findResponsiveHolderPids({ state: existing, now: now });
    const resumedHolders = existing === null ? [] : findResponsiveResumedHolders({ state: existing, now: now });
    const isHeldByPeer =
      (holderPids.length > 0 && existing?.holderCwd !== caller.cwd) ||
      resumedHolders.some((resumedHolder) => resumedHolder.cwd !== caller.cwd);
    // Waiters from the caller's own checkout share the lock with it, so only other checkouts can be ahead.
    const isPeerAhead = otherWaiters.some((waiter) => waiter.cwd !== caller.cwd && compareQueuePlaces(waiter, caller) < 0);

    if (!isHeldByPeer && !isPeerAhead) {
      const isJoining = existing !== null && holderPids.length > 0;
      await writeState({
        holderCwd: caller.cwd,
        holderPids: [...holderPids, caller.pid],
        acquiredAt: isJoining ? existing.acquiredAt : now,
        holdDeadlineAt: Math.max(isJoining ? (existing.holdDeadlineAt ?? 0) : 0, now + params.holdLimitMs),
        waiters: otherWaiters,
        resumedHolders: resumedHolders,
      });
      return { acquired: true };
    }

    const line = [...otherWaiters, caller].sort(compareQueuePlaces);
    const blockingState: ILockState =
      existing === null || holderPids.length === 0
        ? { holderCwd: "", holderPids: [], acquiredAt: 0, waiters: line, resumedHolders: resumedHolders }
        : { ...existing, holderPids: holderPids, waiters: line, resumedHolders: resumedHolders };
    await writeState(blockingState);
    return { acquired: false, blockingState: blockingState, position: line.findIndex(isCaller) + 1 };
  });
}

// A holder whose process exited crashed; one alive past its deadline is stuck. Either way the lock passes on.
function findResponsiveHolderPids(params: { state: ILockState; now: number }): number[] {
  const liveHolderPids = params.state.holderPids.filter((pid) => pidIsAlive(pid));
  if (liveHolderPids.length < params.state.holderPids.length) {
    getLogger().warn("Dropping exited local-execution lock holders", {
      holderCwd: params.state.holderCwd,
      exitedPids: params.state.holderPids.filter((pid) => !liveHolderPids.includes(pid)),
    });
  }
  const isStuck = params.state.holdDeadlineAt !== undefined && params.now > params.state.holdDeadlineAt;
  if (liveHolderPids.length > 0 && isStuck) {
    getLogger().warn("Breaking stuck local-execution lock — its holder outran its run timeout", {
      stuckCwd: params.state.holderCwd,
      stuckPids: liveHolderPids,
      overrunSec: Math.round((params.now - (params.state.holdDeadlineAt as number)) / 1000),
    });
    return [];
  }
  return liveHolderPids;
}

// A resumed run that exited or outran its deadline stops keeping other checkouts out.
function findResponsiveResumedHolders(params: { state: ILockState; now: number }): ILockResumedHolder[] {
  return (params.state.resumedHolders ?? []).filter(
    (resumedHolder) => pidIsAlive(resumedHolder.pid) && params.now <= resumedHolder.holdDeadlineAt,
  );
}

function withoutFirstMatch<T>(entries: T[], isMatch: (entry: T) => boolean): T[] {
  const removalIndex = entries.findIndex(isMatch);
  return removalIndex < 0 ? entries : [...entries.slice(0, removalIndex), ...entries.slice(removalIndex + 1)];
}

async function commitStateWithout(params: {
  existing: ILockState;
  remainingPids: number[];
  remainingResumedHolders: ILockResumedHolder[];
}): Promise<void> {
  if (params.remainingPids.length > 0) {
    await writeState({
      ...params.existing,
      holderPids: params.remainingPids,
      resumedHolders: params.remainingResumedHolders,
    });
    return;
  }
  const waiters = params.existing.waiters ?? [];
  if (waiters.length === 0 && params.remainingResumedHolders.length === 0) {
    await deleteStateFile();
    return;
  }
  await writeState({
    holderCwd: "",
    holderPids: [],
    acquiredAt: 0,
    waiters: waiters,
    resumedHolders: params.remainingResumedHolders,
  });
}

async function removeHolder(params: { normalizedCwd: string; pid: number; holdState: LockHoldStateEnum }): Promise<void> {
  await withModifyLock(async () => {
    const existing = await readState();
    if (existing === null) return;
    const resumedHolders = existing.resumedHolders ?? [];

    if (params.holdState === LockHoldStateEnum.ResumedBesidePeer) {
      await commitStateWithout({
        existing: existing,
        remainingPids: existing.holderPids,
        remainingResumedHolders: withoutFirstMatch(
          resumedHolders,
          (resumedHolder) => resumedHolder.cwd === params.normalizedCwd && resumedHolder.pid === params.pid,
        ),
      });
      return;
    }

    if (existing.holderCwd !== params.normalizedCwd || !existing.holderPids.includes(params.pid)) {
      getLogger().warn("Release skipped — no longer a holder; the lock passed on", {
        ourCwd: params.normalizedCwd,
        holderCwd: existing.holderCwd,
      });
      return;
    }

    await commitStateWithout({
      existing: existing,
      remainingPids: withoutFirstMatch(existing.holderPids, (holderPid) => holderPid === params.pid),
      remainingResumedHolders: resumedHolders,
    });
  });
}

/**
 * Count a run again after its Studio session wait. It rejoins the holders when the lock is free or still its
 * checkout's; when another checkout took the lock meanwhile, the run is already under way, so it counts beside them.
 */
async function reclaimHolder(params: {
  normalizedCwd: string;
  pid: number;
  holdDeadlineAt: number;
}): Promise<LockHoldStateEnum> {
  return await withModifyLock(async (): Promise<LockHoldStateEnum> => {
    const now = Date.now();
    const existing = await readState();
    const holderPids = existing === null ? [] : findResponsiveHolderPids({ state: existing, now: now });
    const resumedHolders = existing === null ? [] : findResponsiveResumedHolders({ state: existing, now: now });

    if (existing !== null && holderPids.length > 0 && existing.holderCwd !== params.normalizedCwd) {
      await writeState({
        ...existing,
        holderPids: holderPids,
        resumedHolders: [
          ...resumedHolders,
          { cwd: params.normalizedCwd, pid: params.pid, holdDeadlineAt: params.holdDeadlineAt },
        ],
      });
      return LockHoldStateEnum.ResumedBesidePeer;
    }

    const isJoining = existing !== null && holderPids.length > 0;
    await writeState({
      holderCwd: params.normalizedCwd,
      holderPids: [...holderPids, params.pid],
      acquiredAt: isJoining ? existing.acquiredAt : now,
      holdDeadlineAt: Math.max(isJoining ? (existing.holdDeadlineAt ?? 0) : 0, params.holdDeadlineAt),
      waiters: existing?.waiters ?? [],
      resumedHolders: resumedHolders,
    });
    return LockHoldStateEnum.Holding;
  });
}

// Session-wait states arrive from a stream handler and release from the run's end, so each change waits for the one before.
function createLockHandle(params: {
  normalizedCwd: string;
  pid: number;
  holdDeadlineAt: number;
}): ILocalExecutionLockHandle {
  let holdState = LockHoldStateEnum.Holding;
  let pendingTransition: Promise<void> = Promise.resolve();
  const enqueueTransition = (applyTransition: () => Promise<void>): Promise<void> => {
    pendingTransition = pendingTransition.catch(() => undefined).then(applyTransition);
    return pendingTransition;
  };
  const holderIdentity = { normalizedCwd: params.normalizedCwd, pid: params.pid };

  return {
    release: () =>
      enqueueTransition(async () => {
        const leavingState = holdState;
        holdState = LockHoldStateEnum.Released;
        if (leavingState === LockHoldStateEnum.Released || leavingState === LockHoldStateEnum.YieldedForSessionWait) {
          return;
        }
        await removeHolder({ ...holderIdentity, holdState: leavingState });
      }),
    yieldForSessionWait: () =>
      enqueueTransition(async () => {
        if (holdState !== LockHoldStateEnum.Holding && holdState !== LockHoldStateEnum.ResumedBesidePeer) return;
        await removeHolder({ ...holderIdentity, holdState: holdState });
        holdState = LockHoldStateEnum.YieldedForSessionWait;
      }),
    reclaimAfterSessionWait: () =>
      enqueueTransition(async () => {
        if (holdState !== LockHoldStateEnum.YieldedForSessionWait) return;
        holdState = await reclaimHolder({ ...holderIdentity, holdDeadlineAt: params.holdDeadlineAt });
      }),
  };
}

/**
 * Acquire the local-execution lock. Resolves when the caller may proceed.
 *
 * Same `cwd` as the current holder → reentrant, returns immediately unless
 * another checkout waits ahead of it.
 * Different `cwd` → takes a place in line and polls every {@link POLL_INTERVAL_MS}ms
 * until the holder releases and no checkout ahead still waits.
 * Dead holder pids, or live ones past their deadline → break-and-take-over.
 *
 * Logs a "waiting for ..." line every {@link WAIT_LOG_INTERVAL_MS}ms while blocked.
 *
 * @param params.cwd - The caller's checkout.
 * @param params.runTimeoutMs - The run's own timeout; past it and {@link HOLD_OVERRUN_GRACE_MS}, the caller is taken as stuck.
 * @param params.lookUpPullRequest - Finds the checkout's open pull request, which ranks its place; `gh` unless a test injects its own.
 * @param params.priority - The run's class, which ranks its place ahead of its pull request; absent reads as Internal.
 */
export async function acquireLocalExecutionLock(params: {
  cwd: string;
  runTimeoutMs: number;
  lookUpPullRequest?: PullRequestLookup;
  priority?: StudioJobPriorityEnum;
}): Promise<ILocalExecutionLockHandle> {
  const normalizedCwd = normalizeCwd(params.cwd);
  const pid = process.pid;
  const startWaitAt = Date.now();
  const caller: ILockWaiter = {
    cwd: normalizedCwd,
    pid: pid,
    priority: params.priority,
    pullRequest: await (params.lookUpPullRequest ?? lookUpCheckoutPullRequest)(normalizedCwd),
    enqueuedAt: startWaitAt,
    lastPolledAt: startWaitAt,
  };
  let lastWaitLogAt = 0;

  while (true) {
    const holdLimitMs = params.runTimeoutMs + HOLD_OVERRUN_GRACE_MS;
    const outcome = await tryAcquireOnce({ caller: caller, holdLimitMs: holdLimitMs });
    if (outcome.acquired) {
      return createLockHandle({ normalizedCwd: normalizedCwd, pid: pid, holdDeadlineAt: Date.now() + holdLimitMs });
    }

    const now = Date.now();
    if (now - lastWaitLogAt >= WAIT_LOG_INTERVAL_MS) {
      const waitedSec = Math.round((now - startWaitAt) / 1000);
      getLogger().info("Waiting for local-execution lock", {
        ourCwd: normalizedCwd,
        heldBy: outcome.blockingState?.holderCwd,
        heldByPids: outcome.blockingState?.holderPids,
        position: outcome.position,
        lineLength: outcome.blockingState?.waiters?.length,
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
