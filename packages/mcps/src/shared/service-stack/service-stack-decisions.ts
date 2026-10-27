/**
 * Pure decisions over the service-stack ledger. Each takes the committed
 * record and returns the record to commit next; the caller commits it only if
 * the ledger is still the generation it read.
 *
 * The contested resource is a port. Checkouts that need the same code on a
 * port share it; a checkout that needs different code there waits until no
 * lease needs the old code. Waiting checkouts are served first come, first
 * served per port, and a checkout keeps its turn for a grace window after the
 * port frees, so an agent that stepped away is not overtaken the moment it does.
 *
 * A lease is held only while its session is testing: a run in flight keeps it,
 * and once none is, it ends shortly after the last one finished.
 */

import {
  CLAIM_GRACE_MS,
  DEAD_HOLDER_GRACE_MS,
  IDLE_RELEASE_MS,
  MAX_RUN_MS,
  OWED_RETRY_AFTER_MS,
  STARTUP_WINDOW_MS,
  SUGGESTED_RETRY_AFTER_MS,
  TICKET_ABANDON_MS,
} from "./service-stack-constants.js";
import type {
  IStackActiveRun,
  IStackBlocker,
  IStackClaimDecision,
  IStackLease,
  IStackNeed,
  IStackRecord,
  IStackReleaseDecision,
  IStackTicket,
} from "./service-stack-types.js";

/** An empty ledger. */
export const EMPTY_STACK_RECORD: IStackRecord = { leases: [], queue: [], portFreedAt: {} };

/**
 * Whether two needs want different code on the same port.
 *
 * @returns True when they cannot both be served at once.
 */
export function needsConflict(left: IStackNeed, right: IStackNeed): boolean {
  return left.port === right.port && (left.runDir !== right.runDir || left.headSha !== right.headSha);
}

/**
 * Drop ended leases and abandoned tickets, recording when each port they
 * needed stopped being needed.
 *
 * A lease with a run in flight never ends for idleness. Without one it ends
 * {@link IDLE_RELEASE_MS} after its last run finished, or
 * {@link STARTUP_WINDOW_MS} after the grant when it has not run yet. It ends
 * sooner when every holder process it recorded has exited and it has gone
 * {@link DEAD_HOLDER_GRACE_MS} untouched — its session is dead.
 *
 * @param params.record - The committed record.
 * @param params.now - Current time (ms since epoch).
 * @param params.isAlive - Whether a process id is still running.
 * @returns The record with only live leases and tickets.
 */
export function sweepStackRecord(params: {
  record: IStackRecord;
  now: number;
  isAlive: (pid: number) => boolean;
}): IStackRecord {
  const { record, now } = params;
  const isLive = (lease: IStackLease) => !hasLeaseEnded({ lease: lease, now: now, isAlive: params.isAlive });
  const liveLeases = record.leases.filter(isLive);
  const expiredLeases = record.leases.filter((lease) => !isLive(lease));
  return {
    leases: liveLeases,
    queue: record.queue.filter((ticket) => now - ticket.lastSeenAt <= TICKET_ABANDON_MS),
    portFreedAt: markFreedPorts({
      portFreedAt: forgetSettledPorts({ portFreedAt: record.portFreedAt, now: now }),
      releasedNeeds: expiredLeases.flatMap((lease) => lease.needs),
      remainingLeases: liveLeases,
      now: now,
    }),
  };
}

/**
 * Apply one claim: grant a lease when no other lease, and no checkout still
 * owed its turn, needs different code on any of the caller's ports; otherwise
 * queue the caller and name what blocks it.
 *
 * A re-claim from a checkout that already holds a lease replaces its needs but
 * does not extend it: only runs keep a lease alive.
 *
 * @param params.record - The committed record as read.
 * @param params.cwd - The caller's normalized checkout root.
 * @param params.label - Name the caller shows peers.
 * @param params.needs - Ports the caller needs and the code each must serve.
 * @param params.now - Current time (ms since epoch).
 * @param params.isAlive - Whether a process id is still running.
 * @returns The verdict and the record to commit.
 */
export function decideStackClaim(params: {
  record: IStackRecord;
  cwd: string;
  label?: string;
  needs: IStackNeed[];
  now: number;
  isAlive: (pid: number) => boolean;
}): IStackClaimDecision {
  const swept = sweepStackRecord({ record: params.record, now: params.now, isAlive: params.isAlive });
  const peerLeases = swept.leases.filter((lease) => lease.cwd !== params.cwd);
  const leaseBlockers = peerLeases.flatMap((lease) => leaseBlockersFor({ lease: lease, needs: params.needs, now: params.now }));

  const queueWithCaller = upsertTicket({
    queue: swept.queue,
    cwd: params.cwd,
    label: params.label,
    needs: params.needs,
    now: params.now,
  });
  const position = queueWithCaller.findIndex((ticket) => ticket.cwd === params.cwd) + 1;
  const ticketBlockers = queueWithCaller
    .slice(0, position - 1)
    .filter((ticket) => isOwedTurn({ ticket: ticket, portFreedAt: swept.portFreedAt, now: params.now }))
    .flatMap((ticket) => ticketBlockersFor({ ticket: ticket, needs: params.needs }));

  if (leaseBlockers.length > 0 || ticketBlockers.length > 0) {
    return {
      isGranted: false,
      next: { ...swept, queue: queueWithCaller },
      blockers: [...leaseBlockers, ...ticketBlockers],
      sharedWith: [],
      position: position,
      queueLength: queueWithCaller.length,
      retryAfterMs: leaseBlockers.length > 0 ? SUGGESTED_RETRY_AFTER_MS : OWED_RETRY_AFTER_MS,
    };
  }

  const ownLease = swept.leases.find((lease) => lease.cwd === params.cwd);
  const grantedLease: IStackLease =
    ownLease === undefined
      ? { cwd: params.cwd, label: params.label, needs: params.needs, grantedAt: params.now, lastSeenAt: params.now }
      : { ...ownLease, label: params.label ?? ownLease.label, needs: params.needs };
  const leases = [...peerLeases, grantedLease];
  return {
    isGranted: true,
    next: {
      leases: leases,
      queue: swept.queue.filter((ticket) => ticket.cwd !== params.cwd),
      portFreedAt: markFreedPorts({
        portFreedAt: swept.portFreedAt,
        releasedNeeds: ownLease?.needs ?? [],
        remainingLeases: leases,
        now: params.now,
      }),
    },
    blockers: [],
    sharedWith: peerLeases
      .filter((lease) => lease.needs.some((need) => params.needs.some((own) => own.port === need.port)))
      .map((lease) => lease.cwd),
    position: null,
    queueLength: swept.queue.filter((ticket) => ticket.cwd !== params.cwd).length,
    retryAfterMs: null,
  };
}

/**
 * Remove the caller's lease and its place in line, and drop every other lease
 * that has ended.
 *
 * @returns The record to commit (null when nothing changes), and whether the caller held anything.
 */
export function decideStackRelease(params: {
  record: IStackRecord;
  cwd: string;
  now: number;
  isAlive: (pid: number) => boolean;
}): IStackReleaseDecision {
  const isReleased =
    params.record.leases.some((lease) => lease.cwd === params.cwd) ||
    params.record.queue.some((ticket) => ticket.cwd === params.cwd);
  const swept = sweepStackRecord({ record: params.record, now: params.now, isAlive: params.isAlive });
  if (!isReleased) return { next: hasSweepDropped({ record: params.record, swept: swept }) ? swept : null, isReleased: false };

  const ownLease = swept.leases.find((lease) => lease.cwd === params.cwd);
  const leases = swept.leases.filter((lease) => lease.cwd !== params.cwd);
  const next: IStackRecord = {
    leases: leases,
    queue: swept.queue.filter((ticket) => ticket.cwd !== params.cwd),
    portFreedAt: markFreedPorts({
      portFreedAt: swept.portFreedAt,
      releasedNeeds: ownLease?.needs ?? [],
      remainingLeases: leases,
      now: params.now,
    }),
  };
  return { next: next, isReleased: true };
}

/**
 * Drop every lease and ticket that has ended.
 *
 * @returns The record to commit, or null when nothing has ended.
 */
export function decideStackReap(params: {
  record: IStackRecord;
  now: number;
  isAlive: (pid: number) => boolean;
}): IStackRecord | null {
  const swept = sweepStackRecord(params);
  return hasSweepDropped({ record: params.record, swept: swept }) ? swept : null;
}

/**
 * Record a run starting under the caller's lease, and its MCP server as a holder.
 *
 * Every parallel run from one checkout runs under the same lease; each adds
 * its MCP server's pid once, and holders that have exited are dropped.
 *
 * @param params.runId - Id the run ends by.
 * @param params.holderPid - MCP server executing the run.
 * @returns The record to commit, or null when the caller holds no live lease and nothing else ended.
 */
export function decideStackRunStart(params: {
  record: IStackRecord;
  cwd: string;
  runId: string;
  holderPid: number;
  now: number;
  isAlive: (pid: number) => boolean;
}): IStackRecord | null {
  const swept = sweepStackRecord({ record: params.record, now: params.now, isAlive: params.isAlive });
  if (!swept.leases.some((lease) => lease.cwd === params.cwd)) return decideStackReap(params);
  const start = (lease: IStackLease): IStackLease => {
    const liveHolders = (lease.holderPids ?? []).filter((pid) => params.isAlive(pid));
    const holderPids = liveHolders.includes(params.holderPid) ? liveHolders : [...liveHolders, params.holderPid];
    const run: IStackActiveRun = { runId: params.runId, holderPid: params.holderPid, startedAt: params.now };
    return {
      ...lease,
      lastSeenAt: params.now,
      holderPids: holderPids,
      activeRuns: [...liveRuns({ lease: lease, now: params.now, isAlive: params.isAlive }), run],
    };
  };
  return { ...swept, leases: swept.leases.map((lease) => (lease.cwd === params.cwd ? start(lease) : lease)) };
}

/**
 * Record a run under the caller's lease ending, which starts its idle window
 * once no other run is in flight.
 *
 * @param params.runId - Id the run started with.
 * @returns The record to commit, or null when the caller holds no live lease and nothing else ended.
 */
export function decideStackRunEnd(params: {
  record: IStackRecord;
  cwd: string;
  runId: string;
  now: number;
  isAlive: (pid: number) => boolean;
}): IStackRecord | null {
  const swept = sweepStackRecord({ record: params.record, now: params.now, isAlive: params.isAlive });
  if (!swept.leases.some((lease) => lease.cwd === params.cwd)) return decideStackReap(params);
  const finish = (lease: IStackLease): IStackLease => {
    const activeRuns = liveRuns({ lease: lease, now: params.now, isAlive: params.isAlive }).filter(
      (run) => run.runId !== params.runId,
    );
    return {
      ...lease,
      lastSeenAt: params.now,
      lastRunEndedAt: params.now,
      activeRuns: activeRuns.length > 0 ? activeRuns : undefined,
    };
  };
  return { ...swept, leases: swept.leases.map((lease) => (lease.cwd === params.cwd ? finish(lease) : lease)) };
}

/**
 * Needs a ledger change dropped: needed before it, needed by no lease after.
 * The service serving each has no one left to serve.
 *
 * @param params.before - The committed record the change was decided against.
 * @param params.after - The record the change commits.
 * @returns Each dropped need once.
 */
export function findVacatedNeeds(params: { before: IStackRecord; after: IStackRecord }): IStackNeed[] {
  const keptNeeds = params.after.leases.flatMap((lease) => lease.needs);
  const vacated: IStackNeed[] = [];
  for (const need of params.before.leases.flatMap((lease) => lease.needs)) {
    const isKept = keptNeeds.some((kept) => isSameNeed(kept, need));
    const isListed = vacated.some((listed) => isSameNeed(listed, need));
    if (!isKept && !isListed) vacated.push(need);
  }
  return vacated;
}

function hasLeaseEnded(params: { lease: IStackLease; now: number; isAlive: (pid: number) => boolean }): boolean {
  if (liveRuns(params).length > 0) return false;
  const holderPids = params.lease.holderPids ?? [];
  const isHolderGone = holderPids.length > 0 && !holderPids.some((pid) => params.isAlive(pid));
  if (isHolderGone && params.now - params.lease.lastSeenAt > DEAD_HOLDER_GRACE_MS) return true;
  const lastRunEndedAt = params.lease.lastRunEndedAt;
  // For a lease that never ran, lastSeenAt is its grant. An older MCP server records no runs and renews
  // lastSeenAt instead, so its lease in mid-run is never mistaken for an idle one and stopped.
  return lastRunEndedAt === undefined
    ? params.now - params.lease.lastSeenAt > STARTUP_WINDOW_MS
    : params.now - lastRunEndedAt > IDLE_RELEASE_MS;
}

function isSameNeed(left: IStackNeed, right: IStackNeed): boolean {
  return left.port === right.port && left.runDir === right.runDir && left.headSha === right.headSha;
}

// A run counts only while its MCP server lives, and only up to MAX_RUN_MS: one whose end was never recorded is lost.
function liveRuns(params: { lease: IStackLease; now: number; isAlive: (pid: number) => boolean }): IStackActiveRun[] {
  return (params.lease.activeRuns ?? []).filter(
    (run) => params.isAlive(run.holderPid) && params.now - run.startedAt <= MAX_RUN_MS,
  );
}

function hasSweepDropped(params: { record: IStackRecord; swept: IStackRecord }): boolean {
  return params.swept.leases.length !== params.record.leases.length || params.swept.queue.length !== params.record.queue.length;
}

function leaseBlockersFor(params: { lease: IStackLease; needs: IStackNeed[]; now: number }): IStackBlocker[] {
  return params.lease.needs
    .filter((held) => params.needs.some((wanted) => needsConflict(held, wanted)))
    .map((held) => ({
      port: held.port,
      blockingCwd: params.lease.cwd,
      blockingLabel: params.lease.label,
      isQueuedAhead: false,
      needsRunDir: held.runDir,
      needsHeadSha: held.headSha,
      heldForMs: params.now - params.lease.grantedAt,
    }));
}

function ticketBlockersFor(params: { ticket: IStackTicket; needs: IStackNeed[] }): IStackBlocker[] {
  return params.ticket.needs
    .filter((ahead) => params.needs.some((wanted) => needsConflict(ahead, wanted)))
    .map((ahead) => ({
      port: ahead.port,
      blockingCwd: params.ticket.cwd,
      blockingLabel: params.ticket.label,
      isQueuedAhead: true,
      needsRunDir: ahead.runDir,
      needsHeadSha: ahead.headSha,
      heldForMs: null,
    }));
}

function upsertTicket(params: {
  queue: IStackTicket[];
  cwd: string;
  label?: string;
  needs: IStackNeed[];
  now: number;
}): IStackTicket[] {
  const existing = params.queue.find((ticket) => ticket.cwd === params.cwd);
  if (existing === undefined) {
    return [
      ...params.queue,
      { cwd: params.cwd, label: params.label, needs: params.needs, enqueuedAt: params.now, lastSeenAt: params.now },
    ];
  }
  return params.queue.map((ticket) =>
    ticket.cwd === params.cwd
      ? { ...ticket, label: params.label ?? ticket.label, needs: params.needs, lastSeenAt: params.now }
      : ticket,
  );
}

function isOwedTurn(params: { ticket: IStackTicket; portFreedAt: Record<string, number>; now: number }): boolean {
  if (params.now - params.ticket.lastSeenAt < CLAIM_GRACE_MS) return true;
  return params.ticket.needs.some((need) => {
    const freedAt = params.portFreedAt[String(need.port)];
    return freedAt !== undefined && params.now - freedAt < CLAIM_GRACE_MS;
  });
}

// Past the grace window a freed time decides nothing, so it is dropped.
function forgetSettledPorts(params: { portFreedAt: Record<string, number>; now: number }): Record<string, number> {
  return Object.fromEntries(
    Object.entries(params.portFreedAt).filter(([, freedAt]) => params.now - freedAt < CLAIM_GRACE_MS),
  );
}

// A port frees when the last lease needing it lets go; one still needed by a
// remaining lease has not freed, whatever else changed.
function markFreedPorts(params: {
  portFreedAt: Record<string, number>;
  releasedNeeds: IStackNeed[];
  remainingLeases: IStackLease[];
  now: number;
}): Record<string, number> {
  const stillNeeded = new Set(params.remainingLeases.flatMap((lease) => lease.needs.map((need) => need.port)));
  const freed = { ...params.portFreedAt };
  for (const need of params.releasedNeeds) {
    if (!stillNeeded.has(need.port)) freed[String(need.port)] = params.now;
  }
  return freed;
}
