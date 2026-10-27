/**
 * Stops the services a ledger change left serving code no lease needs.
 *
 * A lease that ends — released, idle, or its session dead — takes its
 * services with it, so a session that stopped testing holds neither the ports
 * nor the processes behind them. What a port actually serves is read from its
 * listener, because a session may have started it without prepare tracking it.
 */

import type { PortListenerReader } from "./port-listener-types.js";
import type {
  IStackLease,
  IStackNeed,
  IStoppedService,
  ITrackedService,
  ProcessTreeStopper,
} from "./service-stack-types.js";

/**
 * Stop whatever listens on each port whose code no remaining lease needs.
 *
 * A port is left alone when nothing listens or its listener cannot be read,
 * when the listener belongs to a service the user started (`external`), or
 * when it serves code a remaining lease needs there.
 *
 * @param params.vacatedNeeds - Needs the change dropped, from {@link findVacatedNeeds}.
 * @param params.remainingLeases - Leases the change kept.
 * @param params.services - Services prepare tracks, alive.
 * @param params.readListener - Port listener reader.
 * @param params.stopProcessTree - Stops a process tree.
 * @returns Every service stopped.
 */
export async function stopVacatedServices(params: {
  vacatedNeeds: IStackNeed[];
  remainingLeases: IStackLease[];
  services: ITrackedService[];
  readListener: PortListenerReader;
  stopProcessTree: ProcessTreeStopper;
}): Promise<IStoppedService[]> {
  const ports = [...new Set(params.vacatedNeeds.map((need) => need.port))];
  const stopped = await Promise.all(ports.map((port) => stopPortService({ ...params, port: port })));
  return stopped.filter((service): service is IStoppedService => service !== null);
}

async function stopPortService(params: {
  port: number;
  vacatedNeeds: IStackNeed[];
  remainingLeases: IStackLease[];
  services: ITrackedService[];
  readListener: PortListenerReader;
  stopProcessTree: ProcessTreeStopper;
}): Promise<IStoppedService | null> {
  const reading = await params.readListener(params.port);
  const listener = reading.listener;
  if (listener === null) return null;

  const tracked =
    params.services.find(
      (service) =>
        service.port === params.port && (service.pid === listener.pid || listener.ancestorPids.includes(service.pid)),
    ) ?? null;
  if (tracked?.isExternal) return null;
  if (tracked !== null && params.remainingLeases.some((lease) => leaseNeedsService({ lease: lease, service: tracked }))) {
    return null;
  }

  // The tracked root takes its launcher down too; an untracked listener is stopped alone, never its parents.
  const rootPid =
    tracked !== null && params.vacatedNeeds.some((need) => need.runDir === tracked.dir && need.headSha === tracked.headSha)
      ? tracked.pid
      : listener.pid;
  if (rootPid === process.pid || rootPid === process.ppid) return null;

  await params.stopProcessTree(rootPid);
  return { port: params.port, pid: rootPid, name: tracked?.name ?? null, commandLine: listener.commandLine };
}

function leaseNeedsService(params: { lease: IStackLease; service: ITrackedService }): boolean {
  return params.lease.needs.some(
    (need) =>
      need.port === params.service.port && need.runDir === params.service.dir && need.headSha === params.service.headSha,
  );
}
