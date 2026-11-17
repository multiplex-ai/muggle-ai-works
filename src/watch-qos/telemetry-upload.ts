import {
  AgentHost,
  EventName,
  initTelemetry,
  isInitialized,
  isTelemetryEnabled,
  ServiceName,
  Surface,
  track,
  WatchQosDetector as TelemetryWatchQosDetector,
  WatchQosSignal as TelemetryWatchQosSignal,
  type TelemetryEnvironment,
  type WatchQos,
} from "@muggleai/telemetry";
import type { WatchQosLedgerRecord, WatchQosPaths, WatchQosUploadDeps } from "./types.js";

function telemetryValueOf<T extends Record<string, string>>(enumObject: T, value: string): T[keyof T] | undefined {
  return (Object.values(enumObject) as Array<T[keyof T]>).find((candidate) => candidate === value);
}

/**
 * The `watch.qos` event for one ledger record, or undefined when the installed telemetry package does not know one of
 * its enum values. The local `occurrenceKey` never leaves the machine.
 */
export function toWatchQosEvent(record: WatchQosLedgerRecord): WatchQos | undefined {
  const signal = telemetryValueOf(TelemetryWatchQosSignal, record.signal);
  const detector = telemetryValueOf(TelemetryWatchQosDetector, record.detector);
  const host = telemetryValueOf(AgentHost, record.host);
  if (signal === undefined || detector === undefined || host === undefined) return undefined;
  return {
    name: EventName.WatchQos,
    props: {
      signal: signal,
      detector: detector,
      subjectId: record.subjectId,
      ...(record.headId === undefined ? {} : { headId: record.headId }),
      ...(record.delaySeconds === undefined ? {} : { delaySeconds: record.delaySeconds }),
      host: host,
    },
  };
}

/**
 * Upload deps backed by the shared telemetry client, initialised for the watch service the way the MCP server
 * initialises its own. A record whose enums the installed package does not know is consumed as sent, since no later
 * pass could send it either.
 */
export function createTelemetryWatchQosUploadDeps(
  paths: WatchQosPaths,
  connectionString: string,
  environment: TelemetryEnvironment | undefined,
): WatchQosUploadDeps {
  return {
    paths: paths,
    isTelemetryEnabled: isTelemetryEnabled,
    isTelemetryReady: () => {
      initTelemetry({
        serviceName: ServiceName.MuggleMcp,
        surface: Surface.McpLocal,
        connectionString: connectionString,
        environment: environment,
      });
      return isInitialized() && connectionString !== "";
    },
    sendRecord: (record) => {
      const event = toWatchQosEvent(record);
      if (event !== undefined) track(event);
      return true;
    },
  };
}
