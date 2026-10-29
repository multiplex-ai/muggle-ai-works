import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { cwdFromSessionHead, readFileHead } from "./field-parsers.js";

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
