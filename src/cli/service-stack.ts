/**
 * `muggle stack` CLI handlers.
 *
 * Lets agents in different checkouts share the one set of local services E2E
 * runs against. Prepare claims the ports it needs before starting anything,
 * checks the claim before a run, and releases it when the session is done
 * testing. A claim never waits on a peer unless asked to: it answers granted,
 * with what to keep, start or restart on each port, or busy, with who holds
 * the port and this checkout's place in line.
 */

import {
  BUSY_EXIT_CODE,
  StackCheckVerdict,
  StackClaimVerdict,
  checkServiceStack,
  claimServiceStack,
  describeStackMismatch,
  readServiceStackStatus,
  releaseServiceStack,
  type IStackCheckReport,
  type IStackClaimReport,
  type IStackNeedRequest,
  type IStackStatusReport,
} from "@muggleai/mcp";
import type { StackCheckFlags, StackClaimFlags, StackReleaseFlags, StackStatusFlags } from "./service-stack-types.js";

const NEED_PATTERN = /^(\d+)=(.+?)(?:@([0-9a-f]{7,40}))?$/i;

/**
 * Parse one `--need` value.
 *
 * @param value - `<port>=<run-dir>` or `<port>=<run-dir>@<sha>`.
 * @returns The need it states.
 * @throws When the value does not have that shape.
 */
export function parseStackNeed(value: string): IStackNeedRequest {
  const match = NEED_PATTERN.exec(value.trim());
  if (!match) throw new Error(`--need "${value}" is not <port>=<run-dir>[@<sha>]`);
  return { port: Number(match[1]), runDir: match[2], headSha: match[3] };
}

/** Human-readable summary of a claim, one fact per line. */
export function renderStackClaimSummary(report: IStackClaimReport): string {
  if (report.verdict === StackClaimVerdict.Granted) {
    const lines = [`${report.verdict}: the stack is this checkout's to use (${report.cwd})`];
    for (const port of report.plan) {
      const current = port.current ? ` — now ${port.current.dir} @ ${shortSha(port.current.headSha)} (PID ${port.current.pid})` : "";
      lines.push(`${port.action} ${port.port}: ${port.runDir} @ ${shortSha(port.headSha)}${current}`);
    }
    for (const peer of report.sharedWith) lines.push(`shared with: ${peer}`);
    return lines.join("\n");
  }
  const lines = [`${report.verdict}: place ${report.position} of ${report.queueLength} in line`];
  for (const blocker of report.blockers) {
    const who = blocker.blockingLabel ? `${blocker.blockingLabel} (${blocker.blockingCwd})` : blocker.blockingCwd;
    const how = blocker.isQueuedAhead ? "is ahead in line for" : "holds";
    const heldFor = blocker.isQueuedAhead ? "" : ` (for ${seconds(blocker.heldForMs ?? 0)})`;
    lines.push(`port ${blocker.port}: ${who} ${how} ${blocker.needsRunDir} @ ${shortSha(blocker.needsHeadSha)}${heldFor}`);
  }
  lines.push(`retry in ~${seconds(report.retryAfterMs ?? 0)}; your place is kept while you keep asking`);
  return lines.join("\n");
}

/** Human-readable summary of a check. */
export function renderStackCheckSummary(report: IStackCheckReport): string {
  return [`${report.verdict}: ${report.reason}`, ...report.mismatches.map(describeStackMismatch)].join("\n");
}

/** Human-readable summary of the whole ledger. */
export function renderStackStatusSummary(report: IStackStatusReport): string {
  const now = Date.now();
  const lines = [`generation ${report.generation}`];
  if (report.leases.length === 0) lines.push("leases: none");
  for (const lease of report.leases) {
    const ports = lease.needs.map((need) => `${need.port}=${need.runDir}@${shortSha(need.headSha)}`).join(", ");
    lines.push(`lease: ${lease.label ?? lease.cwd} — ${ports} (held ${seconds(now - lease.grantedAt)}, renewed ${seconds(now - lease.lastSeenAt)} ago)`);
  }
  report.queue.forEach((ticket, index) => {
    const ports = ticket.needs.map((need) => need.port).join(", ");
    lines.push(`waiting ${index + 1}: ${ticket.label ?? ticket.cwd} — port ${ports} (asked ${seconds(now - ticket.lastSeenAt)} ago)`);
  });
  for (const service of report.services) {
    lines.push(`service: ${service.port} ${service.name} — ${service.dir} @ ${shortSha(service.headSha)} (PID ${service.pid})`);
  }
  return lines.join("\n");
}

/**
 * Claim the ports a checkout's E2E run needs.
 *
 * Exits 0 when granted and {@link BUSY_EXIT_CODE} when busy, so a script can
 * tell a held stack from a failure.
 *
 * @param flags - `--cwd`, `--need` (repeatable), `--label`, `--wait`, `--json`.
 */
export async function stackClaimCommand(flags: StackClaimFlags): Promise<void> {
  const needs = flags.need.map((value) => parseStackNeed(value));
  const report = await claimServiceStack({
    cwd: flags.cwd ?? process.cwd(),
    label: flags.label,
    needs: needs,
    waitMs: flags.wait === undefined ? undefined : Number(flags.wait) * 1000,
  });
  writeReport({ json: flags.json, report: report, summary: renderStackClaimSummary(report) });
  if (report.verdict === StackClaimVerdict.Busy) process.exitCode = BUSY_EXIT_CODE;
}

/**
 * Check that the stack still serves what this checkout claimed, renewing the lease.
 *
 * Exits 1 on `STALE` or `PEER_LEASE`.
 *
 * @param flags - `--cwd`, `--port`, `--json`.
 */
export async function stackCheckCommand(flags: StackCheckFlags): Promise<void> {
  const report = await checkServiceStack({
    cwd: flags.cwd ?? process.cwd(),
    port: flags.port === undefined ? undefined : Number(flags.port),
    shouldRenew: true,
  });
  writeReport({ json: flags.json, report: report, summary: renderStackCheckSummary(report) });
  if (report.verdict === StackCheckVerdict.Stale || report.verdict === StackCheckVerdict.PeerLease) process.exitCode = 1;
}

/**
 * Give up this checkout's lease and its place in line.
 *
 * @param flags - `--cwd`, `--json`.
 */
export async function stackReleaseCommand(flags: StackReleaseFlags): Promise<void> {
  const isReleased = await releaseServiceStack({ cwd: flags.cwd ?? process.cwd() });
  const summary = isReleased ? "released" : "nothing to release";
  writeReport({ json: flags.json, report: { released: isReleased }, summary: summary });
}

/**
 * Print every lease, the line, and the services prepare tracks.
 *
 * @param flags - `--json`.
 */
export async function stackStatusCommand(flags: StackStatusFlags): Promise<void> {
  const report = await readServiceStackStatus();
  writeReport({ json: flags.json, report: report, summary: renderStackStatusSummary(report) });
}

function writeReport(params: { json?: boolean; report: unknown; summary: string }): void {
  const output = params.json ? JSON.stringify(params.report, null, 2) : params.summary;
  process.stdout.write(`${output}\n`);
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "unknown";
}

function seconds(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}
