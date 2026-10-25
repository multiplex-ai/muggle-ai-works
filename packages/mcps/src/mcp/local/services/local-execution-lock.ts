/**
 * Cross-process execution lane for local Electron runs.
 *
 * One browser runs at a time across checkouts; within one checkout runs are
 * reentrant — parallel calls from the same `cwd` share the lane via a pid list.
 *
 * Coordination is optimistic and never blocks a writer on another writer.
 * Every state is an immutable, numbered generation file; a writer reads the
 * newest generation, computes the next state, and commits it by linking a
 * fully written file to the next generation's name. The link fails when any
 * other writer committed first, and the loser re-reads and re-decides. There is
 * no mutex to strand: a crashed writer leaves at most an orphaned pending file.
 *
 * It is responsive toward callers: an attempt answers at once — granted, or
 * busy with who holds the lane and the caller's place in line — so a caller
 * chooses how long to wait instead of hanging until a peer finishes. Waiting
 * checkouts form a first-come line, and a checkout keeps its turn for a grace
 * window after the lane frees, so a caller that stepped away to do other work
 * is not overtaken the moment it looks away.
 *
 * Key identity = caller's absolute cwd. A "change" = a worktree path.
 */

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { getDataDir } from "../../../shared/data-dir.js";
import { getLogger } from "../../../shared/logger.js";
import { LocalExecutionLaneBusyError } from "./local-execution-lane-busy-error.js";
import {
  CLAIM_GRACE_MS,
  COMMIT_RETRY_JITTER_MS,
  GENERATION_DIGITS,
  GENERATION_FILE_PREFIX,
  GENERATION_FILE_SUFFIX,
  GENERATIONS_KEPT,
  LANE_DIR_NAME,
  LEGACY_LOCK_FILE_NAME,
  MAX_COMMIT_ATTEMPTS,
  PENDING_FILE_PREFIX,
  POLL_INTERVAL_MS,
  SUGGESTED_RETRY_AFTER_MS,
  TICKET_ABANDON_MS,
  TICKET_REFRESH_MS,
  WAIT_LOG_INTERVAL_MS,
} from "./local-execution-lock-constants.js";
import {
  LaneGrantReason,
  LaneRelation,
  type ILaneAcquireDecision,
  type ILaneAttempt,
  type ILaneBusyDetails,
  type ILaneHolder,
  type ILaneRecord,
  type ILaneSnapshot,
  type ILaneStatusReport,
  type ILegacyLockState,
  type ILocalExecutionLockHandle,
} from "./local-execution-lock-types.js";

export { LaneGrantReason, LaneRelation } from "./local-execution-lock-types.js";
export type {
  ILaneAttempt,
  ILaneBusyDetails,
  ILaneStatusReport,
  ILocalExecutionLockHandle,
} from "./local-execution-lock-types.js";
export { LocalExecutionLaneBusyError } from "./local-execution-lane-busy-error.js";

const EMPTY_RECORD: ILaneRecord = { holder: null, queue: [], freedAt: null };

/**
 * Apply one acquire request to the lane's record. Pure: the caller commits
 * `next` only if the record is still the generation it read.
 *
 * Dead holders and abandoned tickets are swept first. Then: the caller's own
 * checkout holding the lane joins it; anyone else holding it queues the caller;
 * a free lane goes to the caller unless a checkout ahead is still owed its turn.
 *
 * @param params.record - The committed record as read.
 * @param params.cwd - The caller's normalized checkout.
 * @param params.pid - The caller's process id.
 * @param params.now - Current time (ms since epoch).
 * @param params.isAlive - Whether a process id is still running.
 * @param params.foreignHolder - A holder outside the lane's own record (a pre-lane server) that occupies it.
 * @returns The verdict and the record to commit.
 */
export function decideLaneAcquire(params: {
  record: ILaneRecord;
  cwd: string;
  pid: number;
  now: number;
  isAlive: (pid: number) => boolean;
  foreignHolder?: ILaneHolder | null;
}): ILaneAcquireDecision {
  const swept = sweepLaneRecord({ record: params.record, now: params.now, isAlive: params.isAlive });

  if (swept.holder !== null && swept.holder.cwd === params.cwd) {
    return {
      granted: true,
      reason: LaneGrantReason.SameCheckout,
      next: {
        holder: { ...swept.holder, pids: [...swept.holder.pids, params.pid] },
        queue: swept.queue.filter((ticket) => ticket.cwd !== params.cwd),
        freedAt: null,
      },
    };
  }

  const queue = upsertTicket({ queue: swept.queue, cwd: params.cwd, pid: params.pid, now: params.now });
  const position = queue.findIndex((ticket) => ticket.cwd === params.cwd) + 1;
  const occupant = swept.holder ?? (params.foreignHolder?.cwd === params.cwd ? null : params.foreignHolder ?? null);

  if (occupant !== null) {
    return {
      granted: false,
      busy: {
        holderCwd: occupant.cwd,
        heldForMs: params.now - occupant.acquiredAt,
        position: position,
        queueLength: queue.length,
      },
      next: { ...swept, queue: queue },
    };
  }

  const owedAhead = queue
    .slice(0, position - 1)
    .filter((ticket) => isOwedTurn({ ticketLastSeenAt: ticket.lastSeenAt, freedAt: swept.freedAt, now: params.now }));

  if (owedAhead.length > 0) {
    return {
      granted: false,
      busy: { holderCwd: null, heldForMs: null, position: position, queueLength: queue.length },
      next: { ...swept, queue: queue },
    };
  }

  return {
    granted: true,
    reason: LaneGrantReason.Free,
    next: {
      holder: { cwd: params.cwd, pids: [params.pid], acquiredAt: params.now },
      queue: queue.filter((ticket) => ticket.cwd !== params.cwd),
      freedAt: null,
    },
  };
}

/**
 * Remove one holder pid from the lane's record. Pure.
 *
 * @param params.record - The committed record as read.
 * @param params.cwd - The releasing caller's normalized checkout.
 * @param params.pid - The releasing caller's process id.
 * @param params.now - Current time (ms since epoch).
 * @returns The record to commit, or null when this caller holds nothing to release.
 */
export function decideLaneRelease(params: {
  record: ILaneRecord;
  cwd: string;
  pid: number;
  now: number;
}): ILaneRecord | null {
  const holder = params.record.holder;
  if (holder === null || holder.cwd !== params.cwd) return null;

  const removalIndex = holder.pids.indexOf(params.pid);
  if (removalIndex < 0) return null;

  const remainingPids = [...holder.pids.slice(0, removalIndex), ...holder.pids.slice(removalIndex + 1)];
  if (remainingPids.length > 0) {
    return { ...params.record, holder: { ...holder, pids: remainingPids } };
  }
  return { ...params.record, holder: null, freedAt: params.now };
}

/**
 * Make one acquire attempt that never waits on a peer's run.
 *
 * @param params.cwd - The caller's checkout.
 * @returns Granted with a release handle, or busy with who holds the lane and the caller's place in line.
 */
export async function tryAcquireLocalExecutionLane(params: { cwd: string }): Promise<ILaneAttempt> {
  const normalizedCwd = normalizeCwd(params.cwd);
  const pid = process.pid;
  let lastBusy: Extract<ILaneAcquireDecision, { granted: false }> | null = null;
  let legacyHolder: ILegacyLockState | null = null;

  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
    const snapshot = await readSnapshot();
    legacyHolder = await readLegacyHolder();
    const decision = decideLaneAcquire({
      record: snapshot,
      cwd: normalizedCwd,
      pid: pid,
      now: Date.now(),
      isAlive: pidIsAlive,
      foreignHolder: legacyHolder === null ? null : legacyHolderAsLaneHolder(legacyHolder),
    });

    if (!decision.granted && recordsMatch({ left: snapshot, right: decision.next })) {
      return { granted: false, busy: toBusyDetails({ decision: decision, legacyHolder: legacyHolder }) };
    }

    const committed = await commitRecord({ expectedGeneration: snapshot.generation, record: decision.next });
    if (committed && decision.granted) {
      return {
        granted: true,
        reason: decision.reason,
        handle: { release: () => releaseLane({ normalizedCwd: normalizedCwd, pid: pid }) },
      };
    }
    if (committed && !decision.granted) {
      return { granted: false, busy: toBusyDetails({ decision: decision, legacyHolder: legacyHolder }) };
    }

    if (!decision.granted) lastBusy = decision;
    await pauseBeforeRetry();
  }

  getLogger().warn("Local execution lane commit kept losing the race", { cwd: normalizedCwd });
  const busy: ILaneBusyDetails =
    lastBusy !== null
      ? toBusyDetails({ decision: lastBusy, legacyHolder: legacyHolder })
      : {
          holderCwd: null,
          heldForMs: null,
          position: 1,
          queueLength: 1,
          heldByLegacyServer: false,
          retryAfterMs: POLL_INTERVAL_MS,
        };
  return { granted: false, busy: busy };
}

/**
 * Acquire the execution lane, waiting up to `waitMs` for a peer's run to end.
 *
 * Same `cwd` as the current holder → reentrant, returns immediately.
 * Different `cwd` → re-attempts every {@link POLL_INTERVAL_MS}ms, holding its place in line.
 * Dead holder pids → swept on the next attempt (assumes crash).
 *
 * @param params.cwd - The caller's checkout.
 * @param params.waitMs - Longest wait; omitted, waits until the lane is granted.
 * @returns A handle to release the lane.
 * @throws {LocalExecutionLaneBusyError} When `waitMs` ran out with the lane still held.
 */
export async function acquireLocalExecutionLock(params: {
  cwd: string;
  waitMs?: number;
}): Promise<ILocalExecutionLockHandle> {
  const startWaitAt = Date.now();
  let lastWaitLogAt = 0;

  while (true) {
    const attempt = await tryAcquireLocalExecutionLane({ cwd: params.cwd });
    if (attempt.granted) return attempt.handle;

    const now = Date.now();
    const waitedMs = now - startWaitAt;
    if (params.waitMs !== undefined && waitedMs >= params.waitMs) {
      throw new LocalExecutionLaneBusyError({ busy: attempt.busy, waitedMs: waitedMs });
    }

    if (now - lastWaitLogAt >= WAIT_LOG_INTERVAL_MS) {
      getLogger().info("Waiting for local execution lane", {
        ourCwd: normalizeCwd(params.cwd),
        heldBy: attempt.busy.holderCwd,
        position: attempt.busy.position,
        waitedSec: Math.round(waitedMs / 1000),
      });
      lastWaitLogAt = now;
    }

    const remainingMs = params.waitMs === undefined ? POLL_INTERVAL_MS : params.waitMs - waitedMs;
    await sleep(Math.max(0, Math.min(POLL_INTERVAL_MS, remainingMs)));
  }
}

/**
 * Read the lane without changing it.
 *
 * @param params.cwd - Optional checkout to report the lane relative to.
 * @returns The committed state, any live pre-lane holder, and — when `cwd` is given — its relation and place in line.
 */
export async function readLocalExecutionLaneStatus(params: { cwd?: string } = {}): Promise<ILaneStatusReport> {
  const snapshot = await readSnapshot();
  const swept = sweepLaneRecord({ record: snapshot, now: Date.now(), isAlive: pidIsAlive });
  const legacyHolder = await readLegacyHolder();
  const report: ILaneStatusReport = {
    generation: snapshot.generation,
    holder: swept.holder,
    queue: swept.queue,
    freedAt: swept.freedAt,
    legacyHolder: legacyHolder,
  };
  if (params.cwd === undefined) return report;

  const normalizedCwd = normalizeCwd(params.cwd);
  const holderCwd = swept.holder?.cwd ?? legacyHolder?.holderCwd ?? null;
  const relation =
    holderCwd === null ? LaneRelation.Free : holderCwd === normalizedCwd ? LaneRelation.HeldByYou : LaneRelation.HeldByPeer;
  const queueIndex = swept.queue.findIndex((ticket) => ticket.cwd === normalizedCwd);
  return { ...report, relation: relation, position: queueIndex >= 0 ? queueIndex + 1 : undefined };
}

async function releaseLane(params: { normalizedCwd: string; pid: number }): Promise<void> {
  for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
    const snapshot = await readSnapshot();
    const next = decideLaneRelease({ record: snapshot, cwd: params.normalizedCwd, pid: params.pid, now: Date.now() });
    if (next === null) {
      getLogger().warn("Lane release skipped — this caller no longer holds it", {
        ourCwd: params.normalizedCwd,
        holderCwd: snapshot.holder?.cwd,
      });
      return;
    }
    if (await commitRecord({ expectedGeneration: snapshot.generation, record: next })) return;
    await pauseBeforeRetry();
  }
  getLogger().error("Local execution lane release kept losing the race", { cwd: params.normalizedCwd });
}

function sweepLaneRecord(params: { record: ILaneRecord; now: number; isAlive: (pid: number) => boolean }): ILaneRecord {
  const { record, now, isAlive } = params;
  let holder = record.holder;
  let freedAt = record.freedAt;
  if (holder !== null) {
    const livePids = holder.pids.filter((pid) => isAlive(pid));
    if (livePids.length === 0) {
      getLogger().warn("Sweeping dead local execution lane holder", { staleCwd: holder.cwd, stalePids: holder.pids });
      holder = null;
      freedAt = now;
    } else if (livePids.length !== holder.pids.length) {
      holder = { ...holder, pids: livePids };
    }
  }
  const queue = record.queue.filter((ticket) => isAlive(ticket.pid) && now - ticket.lastSeenAt <= TICKET_ABANDON_MS);
  return { holder: holder, queue: queue, freedAt: freedAt };
}

function upsertTicket(params: { queue: ILaneRecord["queue"]; cwd: string; pid: number; now: number }): ILaneRecord["queue"] {
  const existing = params.queue.find((ticket) => ticket.cwd === params.cwd);
  if (existing === undefined) {
    return [...params.queue, { cwd: params.cwd, pid: params.pid, enqueuedAt: params.now, lastSeenAt: params.now }];
  }
  // Refresh only past the interval, so a caller polling a held lane re-reads without re-writing.
  const isFresh = existing.pid === params.pid && params.now - existing.lastSeenAt < TICKET_REFRESH_MS;
  if (isFresh) return params.queue;
  return params.queue.map((ticket) =>
    ticket.cwd === params.cwd ? { ...ticket, pid: params.pid, lastSeenAt: params.now } : ticket,
  );
}

function isOwedTurn(params: { ticketLastSeenAt: number; freedAt: number | null; now: number }): boolean {
  const askedRecently = params.now - params.ticketLastSeenAt < CLAIM_GRACE_MS;
  const turnJustArrived = params.freedAt !== null && params.now - params.freedAt < CLAIM_GRACE_MS;
  return askedRecently || turnJustArrived;
}

function toBusyDetails(params: {
  decision: Extract<ILaneAcquireDecision, { granted: false }>;
  legacyHolder: ILegacyLockState | null;
}): ILaneBusyDetails {
  const heldByLegacyServer =
    params.legacyHolder !== null && params.decision.busy.holderCwd === params.legacyHolder.holderCwd;
  return {
    ...params.decision.busy,
    heldByLegacyServer: heldByLegacyServer,
    retryAfterMs: params.decision.busy.holderCwd === null ? POLL_INTERVAL_MS : SUGGESTED_RETRY_AFTER_MS,
  };
}

function recordsMatch(params: { left: ILaneRecord; right: ILaneRecord }): boolean {
  const toComparable = (record: ILaneRecord) =>
    JSON.stringify({ holder: record.holder, queue: record.queue, freedAt: record.freedAt });
  return toComparable(params.left) === toComparable(params.right);
}

function legacyHolderAsLaneHolder(legacy: ILegacyLockState): ILaneHolder {
  return { cwd: legacy.holderCwd, pids: legacy.holderPids, acquiredAt: legacy.acquiredAt };
}

function laneDir(): string {
  return path.join(getDataDir(), LANE_DIR_NAME);
}

function generationFileName(generation: number): string {
  return GENERATION_FILE_PREFIX + String(generation).padStart(GENERATION_DIGITS, "0") + GENERATION_FILE_SUFFIX;
}

function parseGenerationFileName(fileName: string): number | null {
  if (!fileName.startsWith(GENERATION_FILE_PREFIX) || !fileName.endsWith(GENERATION_FILE_SUFFIX)) return null;
  const digits = fileName.slice(GENERATION_FILE_PREFIX.length, fileName.length - GENERATION_FILE_SUFFIX.length);
  if (!/^\d+$/.test(digits)) return null;
  return Number(digits);
}

async function listGenerations(): Promise<number[]> {
  try {
    const fileNames = await fs.readdir(laneDir());
    return fileNames
      .map((fileName) => parseGenerationFileName(fileName))
      .filter((generation): generation is number => generation !== null)
      .sort((left, right) => left - right);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readSnapshot(): Promise<ILaneSnapshot> {
  for (;;) {
    const generations = await listGenerations();
    const newest = generations.at(-1);
    if (newest === undefined) return { generation: 0, ...EMPTY_RECORD };
    try {
      const raw = await fs.readFile(path.join(laneDir(), generationFileName(newest)), "utf-8");
      const record = JSON.parse(raw) as ILaneRecord;
      return { generation: newest, holder: record.holder, queue: record.queue ?? [], freedAt: record.freedAt ?? null };
    } catch (error) {
      // Pruned between listing and reading: a newer generation exists, so list again.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      if (error instanceof SyntaxError) {
        getLogger().warn("Unreadable local execution lane generation; treating it as empty", { generation: newest });
        return { generation: newest, ...EMPTY_RECORD };
      }
      throw error;
    }
  }
}

/**
 * Commit `record` as the generation after `expectedGeneration`. The pending
 * file is complete before it is linked, so a reader never sees a partial
 * state, and the link fails when another writer took that generation first.
 */
async function commitRecord(params: { expectedGeneration: number; record: ILaneRecord }): Promise<boolean> {
  const directory = laneDir();
  await fs.mkdir(directory, { recursive: true });
  const nextGeneration = params.expectedGeneration + 1;
  const pendingPath = path.join(directory, `${PENDING_FILE_PREFIX}${process.pid}-${randomUUID()}.json`);
  await fs.writeFile(pendingPath, JSON.stringify(params.record, null, 2), "utf-8");
  try {
    await fs.link(pendingPath, path.join(directory, generationFileName(nextGeneration)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    await fs.unlink(pendingPath).catch(() => undefined);
  }
  await pruneGenerations({ newestGeneration: nextGeneration });
  return true;
}

async function pruneGenerations(params: { newestGeneration: number }): Promise<void> {
  const directory = laneDir();
  const fileNames = await fs.readdir(directory).catch(() => [] as string[]);
  const oldestKept = params.newestGeneration - GENERATIONS_KEPT;
  await Promise.all(
    fileNames.map(async (fileName) => {
      const generation = parseGenerationFileName(fileName);
      const isOldGeneration = generation !== null && generation < oldestKept;
      if (isOldGeneration || isOrphanedPendingFile(fileName)) {
        await fs.unlink(path.join(directory, fileName)).catch(() => undefined);
      }
    }),
  );
}

// A pending file outlives its write only when the writer died between the
// write and the unlink; its pid names the writer.
function isOrphanedPendingFile(fileName: string): boolean {
  if (!fileName.startsWith(PENDING_FILE_PREFIX)) return false;
  const writerPid = Number(fileName.slice(PENDING_FILE_PREFIX.length).split("-")[0]);
  return Number.isInteger(writerPid) && writerPid !== process.pid && !pidIsAlive(writerPid);
}

async function readLegacyHolder(): Promise<ILegacyLockState | null> {
  try {
    const raw = await fs.readFile(path.join(getDataDir(), LEGACY_LOCK_FILE_NAME), "utf-8");
    const legacy = JSON.parse(raw) as ILegacyLockState;
    const livePids = (legacy.holderPids ?? []).filter((pid) => pidIsAlive(pid));
    if (livePids.length === 0) return null;
    return { holderCwd: legacy.holderCwd, holderPids: livePids, acquiredAt: legacy.acquiredAt };
  } catch {
    return null;
  }
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

async function pauseBeforeRetry(): Promise<void> {
  await sleep(Math.random() * COMMIT_RETRY_JITTER_MS);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
