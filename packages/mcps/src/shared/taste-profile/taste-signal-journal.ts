/**
 * Append-only local journal of taste signals (`~/.muggle-ai/taste/signals.jsonl`).
 * The journal never leaves the machine; only the distilled, screened profile is uploaded.
 */

import * as fs from "fs";
import * as path from "path";

import { getTasteSignalJournalPath } from "./taste-paths.js";
import { TasteSignalKind, type ITasteSignal, type ITasteSignalListFilter, type TasteSignalInput } from "./types.js";

const knownSignalKinds = new Set<string>(Object.values(TasteSignalKind));

function isTasteSignal(candidate: unknown): candidate is ITasteSignal {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const record = candidate as Record<string, unknown>;
  return (
    typeof record.kind === "string" &&
    knownSignalKinds.has(record.kind) &&
    typeof record.text === "string" &&
    typeof record.recordedAt === "string"
  );
}

/**
 * Append one signal to the journal, creating the journal on first use.
 * @param signalInput - The signal; `recordedAt` is stamped now.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns The signal as written.
 */
export function appendTasteSignal(signalInput: TasteSignalInput, dataDirOverride?: string): ITasteSignal {
  const journalPath = getTasteSignalJournalPath(dataDirOverride);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });

  const signal: ITasteSignal = { ...signalInput, recordedAt: new Date().toISOString() };
  fs.appendFileSync(journalPath, `${JSON.stringify(signal)}\n`, "utf-8");
  return signal;
}

/**
 * List journal signals oldest first, skipping lines that do not parse as a signal.
 * @param listFilter - Optional project, kind and newest-N narrowing.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns Matching signals; empty when the journal does not exist.
 */
export function listTasteSignals(listFilter: ITasteSignalListFilter = {}, dataDirOverride?: string): ITasteSignal[] {
  const journalPath = getTasteSignalJournalPath(dataDirOverride);
  if (!fs.existsSync(journalPath)) {
    return [];
  }

  const signals: ITasteSignal[] = [];
  for (const journalLine of fs.readFileSync(journalPath, "utf-8").split("\n")) {
    if (journalLine.trim() === "") {
      continue;
    }
    try {
      const parsedLine: unknown = JSON.parse(journalLine);
      if (isTasteSignal(parsedLine)) {
        signals.push(parsedLine);
      }
    } catch {
      // A line torn by an interrupted write is skipped so the rest of the journal stays readable.
    }
  }

  const matchingSignals = signals.filter(
    (signal) =>
      (listFilter.projectId === undefined || signal.projectId === listFilter.projectId) &&
      (listFilter.kind === undefined || signal.kind === listFilter.kind),
  );
  return listFilter.limit === undefined ? matchingSignals : matchingSignals.slice(-listFilter.limit);
}
