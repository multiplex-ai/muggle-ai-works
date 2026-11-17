import { describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  AgentHost,
  EventName,
  WatchQosDetector as TelemetryWatchQosDetector,
  WatchQosSignal as TelemetryWatchQosSignal,
} from "@muggleai/telemetry";
import { appendWatchQosRecord, readWatchQosCursor, readWatchQosPendingRecords, resolveWatchQosPaths } from "../../watch-qos/ledger.js";
import { toWatchQosEvent } from "../../watch-qos/telemetry-upload.js";
import {
  WatchQosDetector,
  WatchQosHost,
  WatchQosSignal,
  WatchQosUploadOutcome,
  type WatchQosLedgerRecord,
  type WatchQosPaths,
  type WatchQosUploadDeps,
} from "../../watch-qos/types.js";
import { uploadWatchQosLedger } from "../../watch-qos/uploader.js";

function ledgerRecord(headId: string): WatchQosLedgerRecord {
  return {
    at: "2026-11-17T10:00:00.000Z",
    signal: WatchQosSignal.CiRedObserved,
    detector: WatchQosDetector.WatchLoop,
    subjectId: "subject-a",
    headId: headId,
    host: WatchQosHost.Codex,
    occurrenceKey: "local-only",
  };
}

function seededPaths(headIds: string[]): WatchQosPaths {
  const paths = resolveWatchQosPaths(join(mkdtempSync(join(tmpdir(), "watch-qos-upload-")), "telemetry"));
  for (const headId of headIds) appendWatchQosRecord(paths, ledgerRecord(headId));
  return paths;
}

function uploadDeps(paths: WatchQosPaths, overrides: Partial<WatchQosUploadDeps> = {}): WatchQosUploadDeps & { sent: WatchQosLedgerRecord[] } {
  const sent: WatchQosLedgerRecord[] = [];
  return {
    paths: paths,
    isTelemetryEnabled: () => true,
    isTelemetryReady: () => true,
    sendRecord: (record) => {
      sent.push(record);
      return true;
    },
    ...overrides,
    sent: sent,
  };
}

describe("uploadWatchQosLedger", () => {
  it("sends every record past the cursor and moves the cursor past them", () => {
    const paths = seededPaths(["h1", "h2"]);
    const deps = uploadDeps(paths);
    expect(uploadWatchQosLedger(deps)).toEqual({ outcome: WatchQosUploadOutcome.Sent, sentCount: 2, skippedCount: 0 });
    expect(deps.sent.map((record) => record.headId)).toEqual(["h1", "h2"]);
    expect(readWatchQosPendingRecords(paths, readWatchQosCursor(paths).offset).records).toEqual([]);
  });

  it("sends only what was appended since the last pass", () => {
    const paths = seededPaths(["h1"]);
    uploadWatchQosLedger(uploadDeps(paths));
    appendWatchQosRecord(paths, ledgerRecord("h2"));
    const deps = uploadDeps(paths);
    uploadWatchQosLedger(deps);
    expect(deps.sent.map((record) => record.headId)).toEqual(["h2"]);
  });

  it("stops at a failed send and leaves it and everything after it pending", () => {
    const paths = seededPaths(["h1", "h2", "h3"]);
    const deps = uploadDeps(paths, { sendRecord: (record) => record.headId !== "h2" });
    expect(uploadWatchQosLedger(deps).sentCount).toBe(1);
    const pending = readWatchQosPendingRecords(paths, readWatchQosCursor(paths).offset);
    expect(pending.records.map((pendingRecord) => pendingRecord.record?.headId)).toEqual(["h2", "h3"]);
  });

  it("treats a throwing send as a failed one", () => {
    const paths = seededPaths(["h1"]);
    const report = uploadWatchQosLedger(
      uploadDeps(paths, {
        sendRecord: () => {
          throw new Error("exporter down");
        },
      }),
    );
    expect(report.sentCount).toBe(0);
    expect(readWatchQosCursor(paths).offset).toBe(0);
  });

  it("consumes the ledger without sending while the user has telemetry off", () => {
    const paths = seededPaths(["h1"]);
    const deps = uploadDeps(paths, { isTelemetryEnabled: () => false });
    expect(uploadWatchQosLedger(deps)).toEqual({ outcome: WatchQosUploadOutcome.OptedOut, sentCount: 0, skippedCount: 1 });
    expect(deps.sent).toEqual([]);
    expect(readWatchQosPendingRecords(paths, readWatchQosCursor(paths).offset).records).toEqual([]);
  });

  it("keeps everything pending when there is no telemetry client to send through", () => {
    const paths = seededPaths(["h1"]);
    expect(uploadWatchQosLedger(uploadDeps(paths, { isTelemetryReady: () => false })).outcome).toBe(
      WatchQosUploadOutcome.TelemetryUnavailable,
    );
    expect(readWatchQosCursor(paths).offset).toBe(0);
  });

  it("steps over an unparseable line", () => {
    const paths = seededPaths(["h1"]);
    appendFileSync(paths.ledgerFile, "garbage\n");
    appendWatchQosRecord(paths, ledgerRecord("h2"));
    const deps = uploadDeps(paths);
    expect(uploadWatchQosLedger(deps)).toEqual({ outcome: WatchQosUploadOutcome.Sent, sentCount: 2, skippedCount: 1 });
  });

  it("reports nothing pending on an empty ledger", () => {
    expect(uploadWatchQosLedger(uploadDeps(seededPaths([]))).outcome).toBe(WatchQosUploadOutcome.NothingPending);
  });
});

describe("toWatchQosEvent", () => {
  it("maps a ledger record onto the watch.qos event and keeps the occurrence key on the machine", () => {
    expect(toWatchQosEvent({ ...ledgerRecord("h1"), delaySeconds: 90 })).toEqual({
      name: EventName.WatchQos,
      props: {
        signal: TelemetryWatchQosSignal.CiRedObserved,
        detector: TelemetryWatchQosDetector.WatchLoop,
        subjectId: "subject-a",
        headId: "h1",
        delaySeconds: 90,
        host: AgentHost.Codex,
      },
    });
  });
});

describe("local watch QoS enums", () => {
  it("carry exactly the telemetry package's values", () => {
    expect(Object.values(WatchQosSignal).sort()).toEqual(Object.values(TelemetryWatchQosSignal).sort());
    expect(Object.values(WatchQosDetector).sort()).toEqual(Object.values(TelemetryWatchQosDetector).sort());
    expect(Object.values(WatchQosHost).sort()).toEqual(Object.values(AgentHost).sort());
  });
});
