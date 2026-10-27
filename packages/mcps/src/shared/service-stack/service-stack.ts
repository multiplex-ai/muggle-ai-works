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
 * The ledger never runs or stops a process. A check before a run compares the
 * lease with the tracking files prepare writes for every service it starts,
 * and with the process actually listening on each claimed port: any change
 * since the claim — a peer that did not claim, a process nobody tracks, a
 * crashed service — makes the stack stale and the run is refused before it
 * reports on the wrong code.
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
import {
  CLAIM_POLL_INTERVAL_MS,
  DEFAULT_PORT_BY_PROTOCOL,
  PREPARE_TRACKING_DIR_SEGMENTS,
  STACK_LEDGER_DIR_NAME,
} from "./service-stack-constants.js";
import {
  EMPTY_STACK_RECORD,
  decideStackClaim,
  decideStackRelease,
  decideStackRenewal,
  sweepStackRecord,
} from "./service-stack-decisions.js";
import {
  StackCheckVerdict,
  StackClaimVerdict,
  StackMismatchKind,
  StackPortAction,
  type IStackCheckReport,
  type IStackClaimReport,
  type IStackMismatch,
  type IStackNeed,
  type IStackNeedRequest,
  type IStackPortPlan,
  type IStackRecord,
  type IStackStatusReport,
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
 * Check, before or after a run, that the stack still serves what the caller's lease needs.
 *
 * @param params.cwd - Any directory inside the caller's checkout.
 * @param params.port - The port the run targets; a peer's lease on it refuses a caller with no claim there.
 * @param params.shouldRenew - Renew a valid lease, as a run in progress does.
 * @param params.holderPid - Long-lived process renewing it, recorded so the lease ends when it exits.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 * @param params.readListener - Port listener reader; the real one unless a test injects its own.
 * @returns The verdict, with every mismatched port.
 */
export async function checkServiceStack(params: {
  cwd: string;
  port?: number;
  shouldRenew?: boolean;
  holderPid?: number;
  runGit?: GitCommandRunner;
  readListener?: PortListenerReader;
}): Promise<IStackCheckReport> {
  const cwd = await resolveCheckoutRoot({ cwd: params.cwd, runGit: params.runGit ?? runGitCommand });
  const snapshot = await readGenerationStore<IStackRecord>({ directory: ledgerDir(), emptyRecord: EMPTY_STACK_RECORD });
  const swept = sweepStackRecord({ record: snapshot.record, now: Date.now(), isAlive: isProcessAlive });
  const ownLease = swept.leases.find((lease) => lease.cwd === cwd) ?? null;
  const base = { cwd: cwd, generation: snapshot.generation, mismatches: [], peerLease: null };

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

  if (params.shouldRenew) {
    await updateGenerationStore({
      directory: ledgerDir(),
      emptyRecord: EMPTY_STACK_RECORD,
      decide: (current) => ({
        next: decideStackRenewal({
          record: current.record,
          cwd: cwd,
          now: Date.now(),
          isAlive: isProcessAlive,
          holderPid: params.holderPid,
        }),
        result: null,
      }),
    });
  }
  return { ...base, verdict: StackCheckVerdict.Valid, reason: "every claimed port serves the claimed code" };
}

/**
 * Give up the caller's lease and its place in line.
 *
 * @param params.cwd - Any directory inside the caller's checkout.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 * @returns True when the caller held a lease or a place to give up.
 */
export async function releaseServiceStack(params: { cwd: string; runGit?: GitCommandRunner }): Promise<boolean> {
  const cwd = await resolveCheckoutRoot({ cwd: params.cwd, runGit: params.runGit ?? runGitCommand });
  const outcome = await updateGenerationStore({
    directory: ledgerDir(),
    emptyRecord: EMPTY_STACK_RECORD,
    decide: (snapshot) => {
      const next = decideStackRelease({ record: snapshot.record, cwd: cwd, now: Date.now() });
      return { next: next, result: next !== null };
    },
  });
  return outcome.result;
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
  const outcome = await updateGenerationStore({
    directory: ledgerDir(),
    emptyRecord: EMPTY_STACK_RECORD,
    decide: (snapshot) => {
      const decision = decideStackClaim({
        record: snapshot.record,
        cwd: params.cwd,
        label: params.label,
        needs: params.needs,
        now: Date.now(),
        isAlive: isProcessAlive,
      });
      return { next: decision.next, result: decision };
    },
  });
  const decision = outcome.result;
  const isGranted = decision.isGranted && outcome.isCommitted;
  const services = isGranted ? await readTrackedServices() : [];
  return {
    verdict: isGranted ? StackClaimVerdict.Granted : StackClaimVerdict.Busy,
    cwd: params.cwd,
    generation: outcome.generation,
    plan: isGranted ? params.needs.map((need) => planPort({ need: need, services: services })) : [],
    blockers: decision.blockers,
    sharedWith: isGranted ? decision.sharedWith : [],
    position: isGranted ? null : (decision.position ?? 1),
    queueLength: decision.queueLength,
    retryAfterMs: isGranted ? null : (decision.retryAfterMs ?? CLAIM_POLL_INTERVAL_MS),
  };
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
            services?: Array<{ name?: string; dir?: string; port?: number; pid?: number; headSha?: string }>;
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
