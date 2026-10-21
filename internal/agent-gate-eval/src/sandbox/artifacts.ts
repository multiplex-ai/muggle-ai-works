/**
 * Whether a run left an expected artifact. Write and Edit really run in the
 * sandbox, so most artifacts are files on disk; Bash never executes, so a
 * `cat > prs.json` writes nothing and counts by naming the path instead.
 */

import type { ArtifactExpectation, ArtifactSnapshot, ToolAttempt } from "../types.js";
import { normalizePathText, resolveSandboxPath, sandboxPathSpellings } from "./paths.js";

function carries(text: unknown, needle: string | undefined): boolean {
  return needle === undefined || (typeof text === "string" && text.includes(needle));
}

function writeAttemptNamesArtifact(
  attempt: ToolAttempt,
  artifact: ArtifactExpectation,
  snapshot: ArtifactSnapshot,
): boolean {
  const filePath = attempt.args.file_path;
  if (attempt.tool !== "Write" || typeof filePath !== "string") return false;
  const written = normalizePathText(resolveSandboxPath(filePath, snapshot.paths));
  const expected = normalizePathText(resolveSandboxPath(artifact.path, snapshot.paths));
  return written === expected && carries(attempt.args.content, artifact.contains);
}

function bashAttemptNamesArtifact(
  attempt: ToolAttempt,
  artifact: ArtifactExpectation,
  spellings: string[],
): boolean {
  const command = attempt.args.command;
  if (attempt.tool !== "Bash" || typeof command !== "string") return false;
  const normalizedCommand = normalizePathText(command);
  return (
    spellings.some((spelling) => normalizedCommand.includes(spelling)) &&
    carries(command, artifact.contains)
  );
}

/**
 * True when the sandbox holds the artifact (carrying `contains`, when set), or
 * a recorded Write or Bash attempt names its path and carries `contains`.
 */
export function isArtifactSatisfied(
  artifact: ArtifactExpectation,
  snapshot: ArtifactSnapshot,
  toolAttempts: ToolAttempt[],
): boolean {
  const fileContent = snapshot.fileContents[artifact.path];
  if (typeof fileContent === "string" && carries(fileContent, artifact.contains)) return true;
  const spellings = sandboxPathSpellings(artifact.path, snapshot.paths);
  return toolAttempts.some(
    (attempt) =>
      writeAttemptNamesArtifact(attempt, artifact, snapshot) ||
      bashAttemptNamesArtifact(attempt, artifact, spellings),
  );
}
