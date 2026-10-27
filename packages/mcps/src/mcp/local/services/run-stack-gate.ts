/**
 * Refuses a local E2E run whose target port is serving code other than what
 * the caller claimed — or code another checkout claimed — in the shared
 * service-stack ledger.
 *
 * Optimistic: nothing is held during a run. The run checks its lease before it
 * starts and again when it ends, renewing it each time; a change in between
 * marks the result as describing a stack that moved under it. A checkout that
 * never claimed is not gated unless its target port belongs to a peer's lease.
 */

import { isLoopbackUrl } from "./run-checkout-gate.js";
import { checkServiceStack, portOfUrl } from "../../../shared/service-stack/service-stack.js";
import {
  StackCheckVerdict,
  type IStackCheckReport,
} from "../../../shared/service-stack/service-stack-types.js";
import type { GitCommandRunner } from "../../../shared/checkout-freshness-types.js";
import type { PortListenerReader } from "../../../shared/service-stack/port-listener-types.js";

const REFUSING_VERDICTS: ReadonlySet<StackCheckVerdict> = new Set([StackCheckVerdict.PeerLease, StackCheckVerdict.Stale]);

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
    shouldRenew: true,
    holderPid: process.pid,
    runGit: params.runGit,
    readListener: params.readListener,
  });
  return REFUSING_VERDICTS.has(report.verdict) ? report : null;
}

/**
 * Re-check the caller's lease after a run, renewing it.
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
    shouldRenew: true,
    holderPid: process.pid,
    runGit: params.runGit,
    readListener: params.readListener,
  });
  return report.verdict === StackCheckVerdict.Stale ? report : null;
}
