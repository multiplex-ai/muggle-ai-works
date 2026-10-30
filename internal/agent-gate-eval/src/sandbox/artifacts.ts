/**
 * Whether a run left an expected artifact. Write and Edit really run in the
 * sandbox, so most artifacts are files on disk; Bash never executes, so a
 * `cat > prs.json` writes nothing and counts by naming the path instead.
 */

import type { ArtifactExpectation, ArtifactSnapshot, ToolAttempt } from "../types.js";
import { normalizePathText, resolveSandboxPath, sandboxPathSpellings } from "./paths.js";

function carriesExpectedContent(text: unknown, artifact: ArtifactExpectation): boolean {
  const hasContains = artifact.contains === undefined || (typeof text === "string" && text.includes(artifact.contains));
  const hasMatch =
    artifact.matches === undefined || (typeof text === "string" && new RegExp(artifact.matches).test(text));
  return hasContains && hasMatch;
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
  return written === expected && carriesExpectedContent(attempt.args.content, artifact);
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether the command reaches `spelling` the way a shell resolves it, from a
 * directory it names: `cd <dir>` then a relative tail, or `NAME=<dir>` then
 * `$NAME/<tail>`. The tail must start a word, so `notprs.json` never stands in
 * for `prs.json`.
 */
function reachesPathThroughDirectory(normalizedCommand: string, spelling: string): boolean {
  const segments = spelling.split("/");
  for (let cut = 1; cut < segments.length; cut++) {
    const directory = escapeForRegExp(segments.slice(0, cut).join("/"));
    const tail = escapeForRegExp(segments.slice(cut).join("/"));
    const directoryEnd = `/?["']?(?=[\\s;&|]|$)`;
    const changesIntoDirectory = new RegExp(`(^|[\\s;&|(])cd\\s+["']?${directory}${directoryEnd}`);
    const namesRelativeTail = new RegExp(`(^|[\\s"'>=])${tail}(?=[\\s"';&|)]|$)`);
    if (changesIntoDirectory.test(normalizedCommand) && namesRelativeTail.test(normalizedCommand)) return true;
    const assignment = new RegExp(`(?:^|[\\s;&|(])([a-z_][a-z0-9_]*)=["']?${directory}${directoryEnd}`, "gi");
    for (const [, variableName] of normalizedCommand.matchAll(assignment)) {
      const expansion = new RegExp(`\\$(\\{${variableName}\\}|${variableName}(?![a-z0-9_]))/${tail}`, "i");
      if (expansion.test(normalizedCommand)) return true;
    }
  }
  return false;
}

function bashAttemptNamesArtifact(
  attempt: ToolAttempt,
  artifact: ArtifactExpectation,
  spellings: string[],
): boolean {
  const command = attempt.args.command;
  if (attempt.tool !== "Bash" || typeof command !== "string") return false;
  const normalizedCommand = normalizePathText(command);
  const namesPath = spellings.some(
    (spelling) => normalizedCommand.includes(spelling) || reachesPathThroughDirectory(normalizedCommand, spelling),
  );
  return namesPath && carriesExpectedContent(command, artifact);
}

/**
 * True when the sandbox holds the artifact (carrying `contains` and matching
 * `matches`, when set), or a recorded Write or Bash attempt names its path — a
 * Bash one directly or through a `cd` or directory variable — and carries the same.
 */
export function isArtifactSatisfied(
  artifact: ArtifactExpectation,
  snapshot: ArtifactSnapshot,
  toolAttempts: ToolAttempt[],
): boolean {
  const fileContent = snapshot.fileContents[artifact.path];
  if (typeof fileContent === "string" && carriesExpectedContent(fileContent, artifact)) return true;
  const spellings = sandboxPathSpellings(artifact.path, snapshot.paths);
  return toolAttempts.some(
    (attempt) =>
      writeAttemptNamesArtifact(attempt, artifact, snapshot) ||
      bashAttemptNamesArtifact(attempt, artifact, spellings),
  );
}
