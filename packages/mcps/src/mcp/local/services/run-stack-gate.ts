/**
 * Refuses a local E2E run whose target port is serving code other than what
 * the caller claimed — or code another checkout claimed — in the shared
 * service-stack ledger, and keeps the caller's lease alive only while its runs
 * are in flight.
 *
 * Optimistic: nothing is held during a run. The run checks its lease before it
 * starts and again when it ends; a change in between marks the result as
 * describing a stack that moved under it. A checkout that never claimed is not
 * gated unless its target port belongs to a peer's lease. One whose lease the
 * ledger ended for going unused is refused until it claims again: its
 * services were stopped with the lease.
 */

import { randomUUID } from "node:crypto";

import { isLoopbackUrl } from "./run-checkout-gate.js";
import { getRunResultStorageService } from "./run-result-storage-service.js";
import { getLogger } from "../../../shared/logger.js";
import {
  checkServiceStack,
  finishStackRun,
  portOfUrl,
  reapServiceStack,
  startStackRun,
} from "../../../shared/service-stack/service-stack.js";
import { IDLE_REAP_DELAY_MS, SERVICE_STOPS_ENV } from "../../../shared/service-stack/service-stack-constants.js";
import {
  StackCheckVerdict,
  type IStackCheckReport,
  type IStackNeed,
} from "../../../shared/service-stack/service-stack-types.js";
import type { GitCommandRunner } from "../../../shared/checkout-freshness-types.js";
import type { PortListenerReader } from "../../../shared/service-stack/port-listener-types.js";

const REFUSING_VERDICTS: ReadonlySet<StackCheckVerdict> = new Set([
  StackCheckVerdict.PeerLease,
  StackCheckVerdict.Stale,
  StackCheckVerdict.Ended,
]);

// One pending reap per MCP server: each run that ends pushes it back.
let idleReapTimer: NodeJS.Timeout | null = null;

/**
 * The stack check that refuses this run, or null when the run may proceed.
 *
 * @param params.cwd - The caller's checkout, as passed to the execute tool.
 * @param params.localUrl - The run target; only loopback targets are checked.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 * @param params.readListener - Port listener reader; the real one unless a test injects its own.
 */
export async function findRunStackRefusal(params: {
  cwd: string;
  localUrl: string;
  runGit?: GitCommandRunner;
  readListener?: PortListenerReader;
}): Promise<IStackCheckReport | null> {
  if (!isLoopbackUrl(params.localUrl)) return null;
  const port = portOfUrl(params.localUrl) ?? undefined;
  const report = await checkServiceStack({
    cwd: params.cwd,
    port: port,
    runGit: params.runGit,
    readListener: params.readListener,
  });
  return REFUSING_VERDICTS.has(report.verdict) ? report : null;
}

/**
 * What the caller's lease serves before a run, every port verified — empty when
 * the target is remote or the lease is missing or stale, so a run that cannot
 * prove its code records none.
 *
 * @param params.cwd - The caller's checkout.
 * @param params.localUrl - The run target; only loopback targets are read.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 * @param params.readListener - Port listener reader; the real one unless a test injects its own.
 */
export async function readServedStack(params: {
  cwd: string;
  localUrl: string;
  runGit?: GitCommandRunner;
  readListener?: PortListenerReader;
}): Promise<IStackNeed[]> {
  if (!isLoopbackUrl(params.localUrl)) return [];
  const report = await checkServiceStack({ cwd: params.cwd, runGit: params.runGit, readListener: params.readListener });
  return report.servedNeeds;
}

/**
 * Stamp a finished run with the stack it ran against, when that stack held from
 * before the run to after it. A stack that changed mid-run is left unstamped:
 * the run described neither the code it started on nor the code it ended on.
 *
 * @param params.runId - The finished run's id.
 * @param params.servedStack - What {@link readServedStack} returned before the run.
 * @param params.stackChange - The post-run stale report, or null when the stack held.
 */
export function recordServedStack(params: {
  runId: string;
  servedStack: IStackNeed[];
  stackChange: IStackCheckReport | null;
}): void {
  if (params.servedStack.length === 0 || params.stackChange !== null) return;
  const storage = getRunResultStorageService();
  const runResult = storage.getRunResult(params.runId);
  if (!runResult) return;
  storage.updateRunResult(params.runId, {
    localExecutionContext: { ...runResult.localExecutionContext, servedStack: params.servedStack },
  });
}

/**
 * Run a local execution under the caller's lease: it holds while the run is in
 * flight, and once this MCP server has had no run for the idle window, the
 * lease ends and its services stop.
 *
 * @param params.cwd - The caller's checkout.
 * @param params.localUrl - The run target; a remote target runs untouched.
 * @param params.execute - The run itself.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 * @returns What the run returned.
 */
export async function runUnderStackLease<TRun>(params: {
  cwd: string;
  localUrl: string;
  execute: () => Promise<TRun>;
  runGit?: GitCommandRunner;
}): Promise<TRun> {
  if (!isLoopbackUrl(params.localUrl)) return await params.execute();
  const runId = randomUUID();
  await startStackRun({ cwd: params.cwd, runId: runId, holderPid: process.pid, runGit: params.runGit });
  try {
    return await params.execute();
  } finally {
    // A ledger failure here must not replace the run's own result or error.
    await finishStackRun({ cwd: params.cwd, runId: runId, runGit: params.runGit }).catch((error: unknown) => {
      getLogger().warn("Could not record the run's end on the service-stack lease", { error: String(error) });
    });
    scheduleIdleReap();
  }
}

/**
 * Re-check the caller's lease after a run.
 *
 * @param params.cwd - The caller's checkout.
 * @param params.localUrl - The run target; only loopback targets are checked.
 * @param params.runGit - Git runner; the real one unless a test injects its own.
 * @param params.readListener - Port listener reader; the real one unless a test injects its own.
 * @returns The stale report when the stack changed during the run, else null.
 */
export async function findStackChangedDuringRun(params: {
  cwd: string;
  localUrl: string;
  runGit?: GitCommandRunner;
  readListener?: PortListenerReader;
}): Promise<IStackCheckReport | null> {
  if (!isLoopbackUrl(params.localUrl)) return null;
  const report = await checkServiceStack({
    cwd: params.cwd,
    runGit: params.runGit,
    readListener: params.readListener,
  });
  return report.verdict === StackCheckVerdict.Stale ? report : null;
}

// Without this, an idle lease would end only when some other session next touched the ledger.
// With stops off there is nothing for the reap to do, and a test's timer must not outlive its temporary ledger.
function scheduleIdleReap(): void {
  if (process.env[SERVICE_STOPS_ENV] === "off") return;
  if (idleReapTimer !== null) clearTimeout(idleReapTimer);
  idleReapTimer = setTimeout(() => {
    idleReapTimer = null;
    reapServiceStack().catch((error: unknown) => {
      getLogger().warn("Could not end idle service-stack leases", { error: String(error) });
    });
  }, IDLE_REAP_DELAY_MS);
  idleReapTimer.unref();
}
