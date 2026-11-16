/**
 * Per-rep transcripts: every event a rep's host printed, then its verdict, one
 * JSON object per line — what a failing rep is read from after the fact.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { TRANSCRIPT_VERDICT_EVENT } from "./constants.js";
import type { RepTranscript, RunVerdict } from "./types.js";

/** `<dir>/<scenario>.rep<n>.jsonl`, with the scenario name made safe as a file name. */
export function transcriptPathFor(transcriptsDir: string, scenarioName: string, repNumber: number): string {
  return path.join(transcriptsDir, `${scenarioName.replace(/[^A-Za-z0-9._-]/g, "_")}.rep${repNumber}.jsonl`);
}

/** Start a rep's transcript file empty; append each event as it arrives and the verdict once at the end. */
export function openRepTranscript(transcriptPath: string): RepTranscript {
  fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
  fs.writeFileSync(transcriptPath, "");
  const appendLine = (value: unknown): void => fs.appendFileSync(transcriptPath, `${JSON.stringify(value)}\n`);
  return {
    appendEvent: appendLine,
    appendVerdict: (repVerdict: RunVerdict) => appendLine({ type: TRANSCRIPT_VERDICT_EVENT, verdict: repVerdict }),
  };
}
