import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { TRANSCRIPT_TAIL_BYTES, USAGE_LIMIT_API_ERROR } from "./constants.js";
import { cwdFromSessionHead, readFileHead, readFileTailLines } from "./field-parsers.js";
import type { LimitStop } from "./types.js";

function findTranscriptPath(projectsDir: string, sessionId: string): string | undefined {
  let projectDirNames: string[];
  try {
    projectDirNames = readdirSync(projectsDir);
  } catch {
    return undefined;
  }
  const transcriptFileName = `${sessionId}.jsonl`;
  for (const projectDirName of projectDirNames) {
    const transcriptPath = join(projectsDir, projectDirName, transcriptFileName);
    if (existsSync(transcriptPath)) return transcriptPath;
  }
  return undefined;
}

interface TranscriptEntry {
  type?: unknown;
  uuid?: unknown;
  timestamp?: unknown;
  isSidechain?: unknown;
  isMeta?: unknown;
  apiError?: unknown;
  apiErrorParams?: { rate_limit_info?: { resetsAt?: unknown } };
}

function parseTranscriptLine(line: string): TranscriptEntry | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as TranscriptEntry) : undefined;
  } catch {
    return undefined;
  }
}

// Only the main thread's own turns count; titles, cost rows, Remote Control
// links and hook output written after a stop do not continue it.
function isConversationTurn(entry: TranscriptEntry): boolean {
  return (entry.type === "user" || entry.type === "assistant") && entry.isSidechain !== true && entry.isMeta !== true;
}

/**
 * The usage-limit notice a Claude session's last turn ended on, or undefined
 * when its last turn ended any other way, its transcript is gone, or that turn
 * lies outside the transcript's tail.
 *
 * Output shape: `{ noticeUuid: "8a8159d6-…", noticedAtMs: 1793296357120, resetsAtMs: 1793308800000 }`
 */
export function readLimitStop(projectsDir: string, sessionId: string): LimitStop | undefined {
  const transcriptPath = findTranscriptPath(projectsDir, sessionId);
  if (transcriptPath === undefined) return undefined;
  const lines = readFileTailLines(transcriptPath, TRANSCRIPT_TAIL_BYTES) ?? [];
  for (let index = lines.length - 1; index >= 0; index--) {
    const entry = parseTranscriptLine(lines[index]);
    if (entry === undefined || !isConversationTurn(entry)) continue;
    if (entry.type !== "assistant" || entry.apiError !== USAGE_LIMIT_API_ERROR) return undefined;
    const noticedAtMs = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
    if (typeof entry.uuid !== "string" || Number.isNaN(noticedAtMs)) return undefined;
    const resetsAtSeconds = entry.apiErrorParams?.rate_limit_info?.resetsAt;
    return {
      noticeUuid: entry.uuid,
      noticedAtMs: noticedAtMs,
      ...(typeof resetsAtSeconds === "number" ? { resetsAtMs: resetsAtSeconds * 1000 } : {}),
    };
  }
  return undefined;
}

/**
 * The working directory a Claude session ran in, read from its transcript, or
 * undefined when the transcript is gone. `claude --resume <id>` finds a session
 * only from inside its own project, so a resume has to start there.
 */
export function findClaudeSessionCwd(projectsDir: string, sessionId: string): string | undefined {
  const transcriptPath = findTranscriptPath(projectsDir, sessionId);
  if (transcriptPath === undefined) return undefined;
  const head = readFileHead(transcriptPath);
  return head === undefined ? undefined : cwdFromSessionHead(head);
}
