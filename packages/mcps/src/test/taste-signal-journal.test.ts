/** Tests for the append-only taste signal journal. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getTasteSignalJournalPath } from "../shared/taste-profile/taste-paths.js";
import { appendTasteSignal, listTasteSignals } from "../shared/taste-profile/taste-signal-journal.js";
import { TasteSignalKind } from "../shared/taste-profile/types.js";
import { TasteSignalAppendInputSchema } from "../mcp/local/contracts/taste-profile-schemas.js";

let dataDir: string;

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "taste-journal-"));
});

afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("taste signal journal", () => {
  it("lives at taste/signals.jsonl under the Muggle home directory", () => {
    expect(getTasteSignalJournalPath(dataDir)).toBe(path.join(dataDir, "taste", "signals.jsonl"));
  });

  it("returns no signals before the first append", () => {
    expect(listTasteSignals({}, dataDir)).toEqual([]);
  });

  it("appends one JSON line per signal and stamps recordedAt", () => {
    const appendedSignal = appendTasteSignal(
      { kind: TasteSignalKind.ReviewComment, text: "Use sentence case for buttons", classification: "actionable" },
      dataDir,
    );
    appendTasteSignal({ kind: TasteSignalKind.E2eFeedback, text: "Wrong button", projectId: "p1" }, dataDir);

    const journalLines = fs.readFileSync(getTasteSignalJournalPath(dataDir), "utf-8").trim().split("\n");
    expect(journalLines).toHaveLength(2);
    expect(JSON.parse(journalLines[0])).toEqual(appendedSignal);
    expect(Number.isNaN(Date.parse(appendedSignal.recordedAt))).toBe(false);
  });

  it("never rewrites earlier lines", () => {
    appendTasteSignal({ kind: TasteSignalKind.ApprovedRequest, text: "first" }, dataDir);
    const firstContent = fs.readFileSync(getTasteSignalJournalPath(dataDir), "utf-8");
    appendTasteSignal({ kind: TasteSignalKind.ApprovedRequest, text: "second" }, dataDir);

    expect(fs.readFileSync(getTasteSignalJournalPath(dataDir), "utf-8").startsWith(firstContent)).toBe(true);
  });

  it("filters by project and kind and keeps the newest N", () => {
    appendTasteSignal({ kind: TasteSignalKind.ReviewComment, text: "a", projectId: "p1" }, dataDir);
    appendTasteSignal({ kind: TasteSignalKind.E2eFeedback, text: "b", projectId: "p1" }, dataDir);
    appendTasteSignal({ kind: TasteSignalKind.ReviewComment, text: "c", projectId: "p2" }, dataDir);
    appendTasteSignal({ kind: TasteSignalKind.ReviewComment, text: "d", projectId: "p1" }, dataDir);

    expect(listTasteSignals({ projectId: "p1" }, dataDir).map((signal) => signal.text)).toEqual(["a", "b", "d"]);
    expect(listTasteSignals({ kind: TasteSignalKind.ReviewComment }, dataDir).map((signal) => signal.text)).toEqual([
      "a",
      "c",
      "d",
    ]);
    expect(listTasteSignals({ limit: 2 }, dataDir).map((signal) => signal.text)).toEqual(["c", "d"]);
  });

  it("skips torn and unknown lines instead of failing", () => {
    appendTasteSignal({ kind: TasteSignalKind.ReviewComment, text: "kept" }, dataDir);
    fs.appendFileSync(getTasteSignalJournalPath(dataDir), '{"kind":"ReviewComm\n{"kind":"Unknown","text":"x","recordedAt":"t"}\n');

    expect(listTasteSignals({}, dataDir).map((signal) => signal.text)).toEqual(["kept"]);
  });

  it("rejects an append with an unknown kind or empty text", () => {
    expect(TasteSignalAppendInputSchema.safeParse({ kind: "Chat", text: "x" }).success).toBe(false);
    expect(TasteSignalAppendInputSchema.safeParse({ kind: "ReviewComment", text: "  " }).success).toBe(false);
    expect(TasteSignalAppendInputSchema.safeParse({ kind: "ReviewComment", text: "ok" }).success).toBe(true);
  });
});
