/**
 * Ledger that lets agents in different checkouts share one set of local
 * services for E2E.
 *
 * A machine runs one stack — one process per port. Before a session starts or
 * tests against services it claims the ports it needs, naming the directory
 * and commit each must serve. Sessions that need the same code share; one that
 * needs different code on a port is told at once who holds it and its place
 * in line, and comes back later rather than waiting inside a call. A granted
 * claim says, per port, whether to keep, start or restart the service.
 *
 * A lease lasts only while its session is testing. Local runs record
 * themselves on it as they start and end; once none is in flight it ends
 * shortly after the last one, and so does a grant that never runs. Whenever a
 * lease ends — released, idle, or its session dead — the commit that drops it
 * stops the services serving code no remaining lease needs.
 *
 * A check before a run compares the lease with the tracking files prepare
 * writes for every service it starts, and with the process actually listening
 * on each claimed port: any change since the claim — a peer that did not
 * claim, a process nobody tracks, a crashed service — makes the stack stale
 * and the run is refused before it reports on the wrong code.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { runGitCommand } from "../git-command-runner.js";
import type { GitCommandRunner } from "../checkout-freshness-types.js";
import { getDataDir } from "../data-dir.js";
import { isProcessAlive, readGenerationStore, updateGenerationStore } from "./generation-store.js";
import { readPortListener } from "./port-listener.js";
import type { PortListenerReader } from "./port-listener-types.js";
import { stopProcessTree } from "./process-tree-stopper.js";
import {
  CLAIM_POLL_INTERVAL_MS,
  DEFAULT_PORT_BY_PROTOCOL,
  PREPARE_TRACKING_DIR_SEGMENTS,
  SERVICE_STOPS_ENV,
  STACK_LEDGER_DIR_NAME,
} from "./service-stack-constants.js";
import {
  EMPTY_STACK_RECORD,
  decideStackClaim,
  decideStackReap,
  decideStackRelease,
  decideStackRunEnd,
  decideStackRunStart,
  findVacatedNeeds,
  sweepStackRecord,
} from "./service-stack-decisions.js";
import { stopVacatedServices } from "./service-stopper.js";
import {
  StackCheckVerdict,
  StackClaimVerdict,
  StackMismatchKind,
  StackPortAction,
  type IStackCheckReport,
  type IStackClaimReport,
  type IStackLease,
  type IStackMismatch,
  type IStackNeed,
  type IStackNeedRequest,
  type IStackPortPlan,
  type IStackRecord,
  type IStackReleaseReport,
  type IStackStatusReport,
  type IStoppedService,
  type ITrackedService,
} from "./service-stack-types.js";

/**
 * Claim the ports a checkout needs. Answers at once unless `waitMs` is given.
 *
 * @param params.cwd - Any directory inside the claiming checkout.
 * @param params.label - Name the session shows peers.
 * @param params.needs - Ports and the directory (and optionally commit) each must serve.
 * @param params.waitMs - Keep re-asking this long while busy; omitted, answer after one attempt.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 * @returns Granted with a per-port plan, or busy with blockers and the caller's place in line.
 * @throws When a need's commit cannot be resolved from its directory.
 */
export async function claimServiceStack(params: {
  cwd: string;
  label?: string;
  needs: IStackNeedRequest[];
  waitMs?: number;
  runGit?: GitCommandRunner;
}): Promise<IStackClaimReport> {
  const runGit = params.runGit ?? runGitCommand;
  const cwd = await resolveCheckoutRoot({ cwd: params.cwd, runGit: runGit });
  const needs = await resolveNeeds({ needs: params.needs, runGit: runGit });
  const startedAt = Date.now();

  for (;;) {
    const report = await claimOnce({ cwd: cwd, label: params.label, needs: needs });
    const hasWaitLeft = params.waitMs !== undefined && Date.now() - startedAt < params.waitMs;
    if (report.verdict === StackClaimVerdict.Granted || !hasWaitLeft) return report;
    await sleep(CLAIM_POLL_INTERVAL_MS);
  }
}

/**
 * Check, before or after a run, that the stack still serves what the caller's
 * lease needs. Never extends the lease: only runs keep it alive.
 *
 * @param params.cwd - Any directory inside the caller's checkout.
 * @param params.port - The port the run targets; a peer's lease on it refuses a caller with no claim there.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 * @param params.readListener - Port listener reader; the real one unless a test injects its own.
 * @returns The verdict, with every mismatched port.
 */
export async function checkServiceStack(params: {
  cwd: string;
  port?: number;
  runGit?: GitCommandRunner;
  readListener?: PortListenerReader;
}): Promise<IStackCheckReport> {
  const cwd = await resolveCheckoutRoot({ cwd: params.cwd, runGit: params.runGit ?? runGitCommand });
  const snapshot = await readGenerationStore<IStackRecord>({ directory: ledgerDir(), emptyRecord: EMPTY_STACK_RECORD });
  const swept = sweepStackRecord({ record: snapshot.record, now: Date.now(), isAlive: isProcessAlive });
  const ownLease = swept.leases.find((lease) => lease.cwd === cwd) ?? null;
  const base = { cwd: cwd, generation: snapshot.generation, mismatches: [], peerLease: null, servedNeeds: [] };

  const isClaimedByCaller = ownLease?.needs.some((need) => need.port === params.port) ?? false;
  const peerLease =
    params.port === undefined || isClaimedByCaller
      ? undefined
      : swept.leases.find((lease) => lease.cwd !== cwd && lease.needs.some((need) => need.port === params.port));
  if (peerLease !== undefined) {
    const peerNeed = peerLease.needs.find((need) => need.port === params.port) as IStackNeed;
    return {
      ...base,
      verdict: StackCheckVerdict.PeerLease,
      reason: `port ${params.port} is leased to ${peerLease.label ?? peerLease.cwd}, serving ${peerNeed.runDir} @ ${shortSha(peerNeed.headSha)}`,
      peerLease: peerLease,
    };
  }
  if (ownLease === null) {
    return { ...base, verdict: StackCheckVerdict.NoLease, reason: "this checkout holds no stack lease" };
  }

  const services = await readTrackedServices();
  const readListener = params.readListener ?? readPortListener;
  const mismatches = (
    await Promise.all(
      ownLease.needs.map((need) => findPortMismatch({ need: need, services: services, readListener: readListener })),
    )
  ).filter((mismatch): mismatch is IStackMismatch => mismatch !== null);
  if (mismatches.length > 0) {
    const ports = mismatches.map((mismatch) => mismatch.need.port).join(", ");
    return {
      ...base,
      verdict: StackCheckVerdict.Stale,
      reason: `port ${ports} does not serve the code this checkout claimed`,
      mismatches: mismatches,
    };
  }

  return {
    ...base,
    verdict: StackCheckVerdict.Valid,
    reason: "every claimed port serves the claimed code",
    servedNeeds: ownLease.needs,
  };
}

/**
 * Record a local run starting under the caller's lease, so the lease holds for as long as it runs.
 *
 * @param params.cwd - Any directory inside the caller's checkout.
 * @param params.runId - Id unique to this run; {@link finishStackRun} ends it.
 * @param params.holderPid - MCP server executing the run, recorded so the lease ends when it exits.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 */
export async function startStackRun(params: {
  cwd: string;
  runId: string;
  holderPid: number;
  runGit?: GitCommandRunner;
}): Promise<void> {
  const cwd = await resolveCheckoutRoot({ cwd: params.cwd, runGit: params.runGit ?? runGitCommand });
  await updateLedger((record) => ({
    next: decideStackRunStart({
      record: record,
      cwd: cwd,
      runId: params.runId,
      holderPid: params.holderPid,
      now: Date.now(),
      isAlive: isProcessAlive,
    }),
    result: null,
  }));
}

/**
 * Record a local run under the caller's lease ending. With no other run in
 * flight, the lease's idle window starts.
 *
 * @param params.cwd - Any directory inside the caller's checkout.
 * @param params.runId - Id the run started with.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 */
export async function finishStackRun(params: { cwd: string; runId: string; runGit?: GitCommandRunner }): Promise<void> {
  const cwd = await resolveCheckoutRoot({ cwd: params.cwd, runGit: params.runGit ?? runGitCommand });
  await updateLedger((record) => ({
    next: decideStackRunEnd({ record: record, cwd: cwd, runId: params.runId, now: Date.now(), isAlive: isProcessAlive }),
    result: null,
  }));
}

/**
 * End every lease past its window and stop the services it left behind.
 *
 * @returns Services stopped.
 */
export async function reapServiceStack(): Promise<IStoppedService[]> {
  const update = await updateLedger((record) => ({
    next: decideStackReap({ record: record, now: Date.now(), isAlive: isProcessAlive }),
    result: null,
  }));
  return update.stoppedServices;
}

/**
 * Give up the caller's lease and its place in line, stopping the services no
 * remaining lease needs.
 *
 * @param params.cwd - Any directory inside the caller's checkout.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 * @returns Whether the caller held a lease or a place, and the services stopped.
 */
export async function releaseServiceStack(params: { cwd: string; runGit?: GitCommandRunner }): Promise<IStackReleaseReport> {
  const cwd = await resolveCheckoutRoot({ cwd: params.cwd, runGit: params.runGit ?? runGitCommand });
  const update = await updateLedger((record) => {
    const decision = decideStackRelease({ record: record, cwd: cwd, now: Date.now(), isAlive: isProcessAlive });
    return { next: decision.next, result: decision.isReleased };
  });
  return { isReleased: update.result, stoppedServices: update.stoppedServices };
}

/**
 * Read the whole ledger and the services prepare tracks, without changing anything.
 *
 * @returns Live leases, the line, and every tracked live service.
 */
export async function readServiceStackStatus(): Promise<IStackStatusReport> {
  const snapshot = await readGenerationStore<IStackRecord>({ directory: ledgerDir(), emptyRecord: EMPTY_STACK_RECORD });
  const swept = sweepStackRecord({ record: snapshot.record, now: Date.now(), isAlive: isProcessAlive });
  return {
    generation: snapshot.generation,
    leases: swept.leases,
    queue: swept.queue,
    services: await readTrackedServices(),
  };
}

/**
 * The port a URL targets.
 *
 * @param url - A run's target URL.
 * @returns Its explicit port, its scheme's default, or null for an unparseable URL.
 */
export function portOfUrl(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return DEFAULT_PORT_BY_PROTOCOL[parsed.protocol] ?? null;
  } catch {
    return null;
  }
}

async function claimOnce(params: { cwd: string; label?: string; needs: IStackNeed[] }): Promise<IStackClaimReport> {
  const update = await updateLedger((record) => {
    const decision = decideStackClaim({
      record: record,
      cwd: params.cwd,
      label: params.label,
      needs: params.needs,
      now: Date.now(),
      isAlive: isProcessAlive,
    });
    return { next: decision.next, result: decision };
  });
  const decision = update.result;
  const isGranted = decision.isGranted && update.isCommitted;
  // Read after the stops, so a port whose old service was just stopped plans as a start.
  const services = isGranted ? await readTrackedServices() : [];
  return {
    verdict: isGranted ? StackClaimVerdict.Granted : StackClaimVerdict.Busy,
    cwd: params.cwd,
    generation: update.generation,
    plan: isGranted ? params.needs.map((need) => planPort({ need: need, services: services })) : [],
    blockers: decision.blockers,
    sharedWith: isGranted ? decision.sharedWith : [],
    position: isGranted ? null : (decision.position ?? 1),
    queueLength: decision.queueLength,
    retryAfterMs: isGranted ? null : (decision.retryAfterMs ?? CLAIM_POLL_INTERVAL_MS),
    stoppedServices: update.stoppedServices,
  };
}

/**
 * Commit one ledger decision, then stop the services serving needs it dropped.
 *
 * The stop follows the commit that drops a lease, and only that one: a commit
 * that loses the race drops nothing, and the next to commit drops what is left.
 */
async function updateLedger<TResult>(
  decide: (record: IStackRecord) => { next: IStackRecord | null; result: TResult },
): Promise<{ isCommitted: boolean; generation: number; result: TResult; stoppedServices: IStoppedService[] }> {
  const outcome = await updateGenerationStore({
    directory: ledgerDir(),
    emptyRecord: EMPTY_STACK_RECORD,
    decide: (snapshot) => {
      const update = decide(snapshot.record);
      const vacatedNeeds = update.next === null ? [] : findVacatedNeeds({ before: snapshot.record, after: update.next });
      return {
        next: update.next,
        result: { decided: update.result, vacatedNeeds: vacatedNeeds, remainingLeases: update.next?.leases ?? [] },
      };
    },
  });
  const stoppedServices = outcome.isCommitted
    ? await stopServicesFor({ vacatedNeeds: outcome.result.vacatedNeeds, remainingLeases: outcome.result.remainingLeases })
    : [];
  return {
    isCommitted: outcome.isCommitted,
    generation: outcome.generation,
    result: outcome.result.decided,
    stoppedServices: stoppedServices,
  };
}

async function stopServicesFor(params: {
  vacatedNeeds: IStackNeed[];
  remainingLeases: IStackLease[];
}): Promise<IStoppedService[]> {
  if (params.vacatedNeeds.length === 0 || process.env[SERVICE_STOPS_ENV] === "off") return [];
  return await stopVacatedServices({
    vacatedNeeds: params.vacatedNeeds,
    remainingLeases: params.remainingLeases,
    services: await readTrackedServices(),
    readListener: readPortListener,
    stopProcessTree: stopProcessTree,
  });
}

function planPort(params: { need: IStackNeed; services: ITrackedService[] }): IStackPortPlan {
  const current = trackedServiceOnPort({ services: params.services, port: params.need.port });
  const action =
    current === null
      ? StackPortAction.Start
      : servesNeed({ service: current, need: params.need })
        ? StackPortAction.Keep
        : StackPortAction.Restart;
  return { ...params.need, action: action, current: current };
}

/**
 * Why a needed port does not serve the claimed code, or null when it does.
 *
 * Tracking files only say what prepare started. The listener says what the
 * port actually serves: a process prepare never recorded, or nothing at all,
 * cannot be shown to serve the claim. A port whose listener cannot be read is
 * judged on tracking alone, so a machine without the platform tool still runs.
 */
async function findPortMismatch(params: {
  need: IStackNeed;
  services: ITrackedService[];
  readListener: PortListenerReader;
}): Promise<IStackMismatch | null> {
  const tracked = trackedServiceOnPort({ services: params.services, port: params.need.port });
  if (tracked !== null && !servesNeed({ service: tracked, need: params.need })) {
    return { need: params.need, kind: StackMismatchKind.OtherCode, actual: tracked, listener: null };
  }

  const reading = await params.readListener(params.need.port);
  if (!reading.isReadable) return null;
  if (reading.listener === null) {
    return { need: params.need, kind: StackMismatchKind.NothingListening, actual: tracked, listener: null };
  }
  const isTrackedListener =
    tracked !== null && (reading.listener.pid === tracked.pid || reading.listener.ancestorPids.includes(tracked.pid));
  if (isTrackedListener) return null;
  return { need: params.need, kind: StackMismatchKind.UntrackedListener, actual: tracked, listener: reading.listener };
}

function servesNeed(params: { service: ITrackedService; need: IStackNeed }): boolean {
  return params.service.dir === params.need.runDir && params.service.headSha === params.need.headSha;
}

function trackedServiceOnPort(params: { services: ITrackedService[]; port: number }): ITrackedService | null {
  return params.services.find((service) => service.port === params.port) ?? null;
}

/**
 * Every service a prepare tracking file records whose process is still alive.
 * Files that cannot be read or parsed are skipped: they belong to another
 * session mid-write, and the next read sees them whole.
 */
async function readTrackedServices(): Promise<ITrackedService[]> {
  const directory = path.join(getDataDir(), ...PREPARE_TRACKING_DIR_SEGMENTS);
  const fileNames = await fs.readdir(directory).catch(() => [] as string[]);
  const perFile = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith(".json"))
      .map(async (fileName) => {
        try {
          const parsed = JSON.parse(await fs.readFile(path.join(directory, fileName), "utf-8")) as {
            source?: string;
            services?: Array<{
              name?: string;
              dir?: string;
              port?: number;
              pid?: number;
              headSha?: string;
              external?: boolean;
            }>;
          };
          return (parsed.services ?? [])
            .filter((service) => typeof service.port === "number" && typeof service.pid === "number")
            .filter((service) => isProcessAlive(service.pid as number))
            .map(
              (service): ITrackedService => ({
                name: service.name ?? "",
                dir: normalizePath(service.dir ?? ""),
                port: service.port as number,
                pid: service.pid as number,
                headSha: service.headSha ?? null,
                source: normalizePath(parsed.source ?? ""),
                isExternal: service.external === true,
              }),
            );
        } catch {
          return [];
        }
      }),
  );
  return perFile.flat();
}

async function resolveNeeds(params: { needs: IStackNeedRequest[]; runGit: GitCommandRunner }): Promise<IStackNeed[]> {
  return await Promise.all(
    params.needs.map(async (need): Promise<IStackNeed> => {
      const runDir = normalizePath(need.runDir);
      const headSha = need.headSha ?? (await params.runGit(["rev-parse", "HEAD"], runDir));
      if (!headSha) throw new Error(`cannot read the commit checked out in ${runDir}`);
      return { port: need.port, runDir: runDir, headSha: headSha };
    }),
  );
}

async function resolveCheckoutRoot(params: { cwd: string; runGit: GitCommandRunner }): Promise<string> {
  const root = await params.runGit(["rev-parse", "--show-toplevel"], params.cwd);
  return normalizePath(root ?? params.cwd);
}

/** Absolute, and case-folded on Windows so `C:\Users\foo` and `c:\users\foo` name one checkout. */
function normalizePath(directory: string): string {
  const resolved = path.resolve(directory);
  return os.platform() === "win32" ? resolved.toLowerCase() : resolved;
}

function ledgerDir(): string {
  return path.join(getDataDir(), STACK_LEDGER_DIR_NAME);
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
