import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { USAGE_LIMIT_NOTICE_PATTERN } from "./constants.js";
import { cwdFromSessionHead, readFileHead, readFileTail } from "./field-parsers.js";

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

function assistantText(entry: { type?: unknown; message?: { content?: unknown } }): string | undefined {
  if (entry.type !== "assistant") return undefined;
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part: { text?: unknown }) => (typeof part?.text === "string" ? part.text : "")).join(" ");
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

/**
 * Whether the session's last assistant reply is Claude's usage-limit notice:
 * the turn ended before doing anything, so a resume that landed there tells
 * nothing about whether the next one will work.
 */
export function isStoppedAtUsageLimit(projectsDir: string, sessionId: string): boolean {
  const transcriptPath = findTranscriptPath(projectsDir, sessionId);
  const tail = transcriptPath === undefined ? undefined : readFileTail(transcriptPath);
  if (tail === undefined) return false;
  const lines = tail.split("\n");
  for (let index = lines.length - 1; index >= 0; index--) {
    let entry: { type?: unknown; message?: { content?: unknown } };
    try {
      entry = JSON.parse(lines[index]) as typeof entry;
    } catch {
      continue;
    }
    const text = assistantText(entry);
    if (text !== undefined) return USAGE_LIMIT_NOTICE_PATTERN.test(text);
  }
  return false;
}
