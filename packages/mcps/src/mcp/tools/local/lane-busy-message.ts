/** Tool-result text for the local execution lane: a turned-away run, and the lane's status. */

import type { ILaneStatusReport, LocalExecutionLaneBusyError } from "../../local/services/index.js";

/** Tool-result text for a run turned away because another checkout's run holds the lane. */
export function formatLaneBusy(error: LocalExecutionLaneBusyError, cwd: string): string {
  const busy = error.busy;
  const holderLine =
    busy.holderCwd === null
      ? "**Held by:** nobody — the lane is free but owed to a checkout ahead in line"
      : `**Held by:** ${busy.holderCwd} (for ${formatSeconds(busy.heldForMs ?? 0)})`;
  const legacyNote = busy.heldByLegacyServer
    ? ["", "The holder runs an older Muggle server that keeps no line; first to ask after it finishes wins."]
    : [];
  return [
    "## Lane busy — another checkout's run holds the local browser",
    "",
    holderLine,
    `**Your checkout:** ${cwd}`,
    `**Place in line:** ${busy.position} of ${busy.queueLength}`,
    `**Waited:** ${formatSeconds(error.waitedMs)}`,
    ...legacyNote,
    "",
    "Nothing was launched, and this is not a test result. Your place in line is kept while you keep asking;",
    `do other work and call again in about ${formatSeconds(busy.retryAfterMs)}, or pass a longer \`laneWaitSeconds\` to wait in the call.`,
  ].join("\n");
}

/** Tool-result text for the lane's current state. */
export function formatLaneStatus(report: ILaneStatusReport, cwd: string | undefined): string {
  const now = Date.now();
  const holder = report.holder;
  const holderLine =
    holder !== null
      ? `**Held by:** ${holder.cwd} — ${holder.pids.length} run(s), for ${formatSeconds(now - holder.acquiredAt)}`
      : report.legacyHolder !== null
        ? `**Held by:** ${report.legacyHolder.holderCwd} (older Muggle server)`
        : "**Held by:** nobody";
  const queueLines =
    report.queue.length === 0
      ? ["**Line:** empty"]
      : [
          "**Line:**",
          ...report.queue.map(
            (ticket, index) => `${index + 1}. ${ticket.cwd} — last asked ${formatSeconds(now - ticket.lastSeenAt)} ago`,
          ),
        ];
  const relationLines =
    cwd === undefined
      ? []
      : [
          "",
          `**Your checkout:** ${cwd}`,
          `**Relation:** ${report.relation}`,
          report.position !== undefined ? `**Your place in line:** ${report.position}` : "",
        ].filter(Boolean);
  return ["## Local execution lane", "", holderLine, ...queueLines, ...relationLines, "", `Generation ${report.generation}`].join(
    "\n",
  );
}

function formatSeconds(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}
