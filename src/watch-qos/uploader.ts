import { readWatchQosCursor, readWatchQosPendingRecords, rotateUploadedWatchQosLedger, writeWatchQosCursor } from "./ledger.js";
import { WatchQosUploadOutcome, type WatchQosUploadDeps, type WatchQosUploadReport } from "./types.js";

/**
 * Hand every ledger record past the upload cursor to telemetry, advancing the cursor only past what was sent.
 *
 * - Opted out: the pending records are consumed without sending, so opting back in never uploads what was recorded
 *   while the user had telemetry off.
 * - No telemetry client (a dev build, a failed init): nothing moves, and the next pass with one sends them.
 * - A send that fails or throws stops the pass there; the rest stay pending.
 *
 * Unparseable lines are stepped over. A fully uploaded ledger past its size cap is rotated.
 */
export function uploadWatchQosLedger(deps: WatchQosUploadDeps): WatchQosUploadReport {
  const cursorOffset = readWatchQosCursor(deps.paths).offset;
  const pending = readWatchQosPendingRecords(deps.paths, cursorOffset);
  if (pending.records.length === 0) {
    if (pending.endOffset !== cursorOffset) writeWatchQosCursor(deps.paths, { offset: pending.endOffset });
    rotateUploadedWatchQosLedger(deps.paths, pending.endOffset);
    return { outcome: WatchQosUploadOutcome.NothingPending, sentCount: 0, skippedCount: 0 };
  }
  if (!deps.isTelemetryEnabled()) {
    writeWatchQosCursor(deps.paths, { offset: pending.endOffset });
    rotateUploadedWatchQosLedger(deps.paths, pending.endOffset);
    return { outcome: WatchQosUploadOutcome.OptedOut, sentCount: 0, skippedCount: pending.records.length };
  }
  if (!deps.isTelemetryReady()) {
    return { outcome: WatchQosUploadOutcome.TelemetryUnavailable, sentCount: 0, skippedCount: 0 };
  }
  let sentCount = 0;
  let skippedCount = 0;
  let uploadedOffset = pending.startOffset;
  for (const pendingRecord of pending.records) {
    if (pendingRecord.record === undefined) {
      skippedCount++;
      uploadedOffset = pendingRecord.endOffset;
      continue;
    }
    let isSent: boolean;
    try {
      isSent = deps.sendRecord(pendingRecord.record);
    } catch {
      isSent = false;
    }
    if (!isSent) break;
    sentCount++;
    uploadedOffset = pendingRecord.endOffset;
  }
  writeWatchQosCursor(deps.paths, { offset: uploadedOffset });
  rotateUploadedWatchQosLedger(deps.paths, uploadedOffset);
  return { outcome: WatchQosUploadOutcome.Sent, sentCount: sentCount, skippedCount: skippedCount };
}
