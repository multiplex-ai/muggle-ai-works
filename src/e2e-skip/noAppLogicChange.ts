import { NON_APP_PATH_PATTERNS, PRE_CYCLE_SHA_TOKEN, REBASED_CYCLE_RANGE_TOKEN } from "./constants.js";
import type { NoAppLogicChangeDetail } from "./types.js";

const FILE_HEADER = "diff --git ";
const BINARY_CHANGE = /^Binary files /;
const POST_IMAGE_BLOB = /^index [0-9a-f]+\.\.([0-9a-f]+)/;
// Header lines that name blobs or line positions, which differ between two bases even when the PR's own edit is identical.
const BASE_DEPENDENT_HEADER = /^(index |--- |\+\+\+ )/;
const HUNK_CHANGE = /^[-+\\]/;

/**
 * Split a `NO_APP_LOGIC_CHANGE` detail into the commit it names, the base tip a rebased cycle names after it, and the stated reason.
 *
 * @returns `null` when the detail does not open with a commit SHA or a `<sha>..<sha>` range.
 */
export function parseNoAppLogicChangeDetail(detail: string): NoAppLogicChangeDetail | null {
  const stated = detail.trim();
  const range = stated.match(REBASED_CYCLE_RANGE_TOKEN);
  const opening = range?.[0] ?? stated.match(PRE_CYCLE_SHA_TOKEN)?.[1];
  if (!opening) return null;
  const reason = stated.slice(opening.length).replace(/^[\s:,;.-]+/, "").trim();
  return { preCycleSha: range?.[1] ?? opening, baseTipSha: range?.[2] ?? null, reason: reason };
}

/** Whether a repo-relative path is in the fixed set that cannot change what a user's browser runs. */
export function isNonAppPath(repoRelativePath: string): boolean {
  return NON_APP_PATH_PATTERNS.some((pattern) => pattern.test(repoRelativePath));
}

// Without renames both sides of the header name one path: `a/<path> b/<path>`.
const pathOfFileHeader = (header: string): string => {
  const sides = header.slice(FILE_HEADER.length);
  return sides.slice(2, 2 + (sides.length - 5) / 2);
};

// A binary change prints the same line whatever changed, so the post-image blob stands in for its content.
const changedLinesByPath = (zeroContextDiff: string): Map<string, string[]> => {
  const changedLines = new Map<string, string[]>();
  let fileLines: string[] | null = null;
  let isInHunk = false;
  let postImageBlob = "";
  for (const line of zeroContextDiff.split("\n")) {
    if (line.startsWith(FILE_HEADER)) {
      fileLines = [];
      changedLines.set(pathOfFileHeader(line), fileLines);
      isInHunk = false;
      postImageBlob = "";
    } else if (!fileLines) {
      continue;
    } else if (line.startsWith("@@")) {
      isInHunk = true;
    } else if (isInHunk) {
      if (HUNK_CHANGE.test(line)) fileLines.push(line);
    } else if (BINARY_CHANGE.test(line)) {
      fileLines.push(`binary ${postImageBlob}`);
    } else if (POST_IMAGE_BLOB.test(line)) {
      postImageBlob = line.match(POST_IMAGE_BLOB)?.[1] ?? "";
    } else if (line && !BASE_DEPENDENT_HEADER.test(line)) {
      fileLines.push(line);
    }
  }
  return changedLines;
};

/**
 * The paths whose own patch differs between two zero-context diffs of a PR against its base.
 *
 * Compares only the lines each file adds and removes, never their positions or
 * the surrounding code, so replaying a PR onto a moved base leaves a path
 * unchanged unless the PR's own edit to it changed.
 *
 * @param beforeDiff - `git diff -U0 --no-renames` of the PR before the rebase, against its fork point.
 * @param afterDiff - The same diff of the rebased PR, against the new base tip.
 *
 * Output shape: `["src/app.ts"]` when only `src/app.ts`'s own edit changed; `[]` for a clean replay.
 */
export function pathsWithChangedPatch(beforeDiff: string, afterDiff: string): string[] {
  const before = changedLinesByPath(beforeDiff);
  const after = changedLinesByPath(afterDiff);
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => {
    const beforeLines = before.get(path);
    const afterLines = after.get(path);
    return !beforeLines || !afterLines || beforeLines.join("\n") !== afterLines.join("\n");
  });
}
