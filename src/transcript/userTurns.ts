import { closeSync, fstatSync, openSync, readSync } from "fs";
import {
  HUMAN_ORIGIN_KIND,
  TEXT_CONTENT_PART_TYPE,
  TOOL_RESULT_CONTENT_PART_TYPE,
  USER_ENTRY_TYPE,
} from "./constants.js";
import type { TranscriptContentPart, TranscriptEntry } from "./types.js";

/**
 * The text a person typed in this transcript entry, or null when anyone else wrote it.
 *
 * Every user-role line is not the user. A tool result, a loaded skill's body, a hook's block reason, a background
 * task's notification, another agent's message and a compaction summary all arrive as `type: "user"` — and each can
 * carry any phrase the agent chose to read, echo or write. A phrase that releases a gate must come from none of them.
 * An entry from a version that stamps no `origin` is judged on the other markers alone.
 */
export function userAuthoredText(entry: TranscriptEntry): string | null {
  if (entry.type !== USER_ENTRY_TYPE) return null;
  if (entry.isMeta || entry.isCompactSummary || entry.isSidechain || entry.toolUseResult !== undefined) return null;
  if (entry.origin != null && entry.origin.kind !== HUMAN_ORIGIN_KIND) return null;
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content as TranscriptContentPart[];
  if (parts.some((part) => part?.type === TOOL_RESULT_CONTENT_PART_TYPE)) return null;
  return parts
    .filter((part) => part?.type === TEXT_CONTENT_PART_TYPE && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

/** The user-authored texts in a JSONL transcript that contain `literal`. Only lines naming it are parsed. */
export function userAuthoredTextsContaining(transcriptJsonl: string, literal: string): string[] {
  const texts: string[] = [];
  for (const line of transcriptJsonl.split("\n")) {
    if (!line.includes(literal)) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }
    const text = userAuthoredText(entry);
    if (text !== null && text.includes(literal)) texts.push(text);
  }
  return texts;
}

/** The last `maxBytes` of a file, read without loading the rest; null when it cannot be read. */
export function readFileTail(filePath: string, maxBytes: number): string | null {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(filePath, "r");
    const fileSize = fstatSync(descriptor).size;
    const length = Math.min(fileSize, maxBytes);
    const tail = Buffer.alloc(length);
    readSync(descriptor, tail, 0, length, fileSize - length);
    return tail.toString("utf-8");
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
