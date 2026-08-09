import { readFileSync, existsSync } from "fs";
import { isAbsolute, resolve } from "path";

/**
 * Substring present in every `muggle build-pr-section` rendering (see
 * src/cli/build-pr-section.ts). Kept as a version-agnostic substring so both
 * gates keep recognising sanctioned output across `:v1` → `:v2` bumps.
 */
export const REPORT_SENTINEL = "muggle-pr-section";

const PR_PROSE_CMD = /\bgh\s+pr\s+(comment|create|edit)\b/;

const GH_API_CMD = /\bgh\s+api\b/;
const ISSUE_COMMENT_PATH = /\bissues\/comments\/\d+/;
const PATCH_METHOD = /(?:--method|-X)[=\s]+PATCH\b/;

/** Reads a path referenced by a command, resolved against the hook's cwd; `null` when unreadable. */
export type FileReader = (path: string, cwd?: string) => string | null;

export const defaultFileReader: FileReader = (path, cwd) => {
  try {
    const abs = isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path);
    if (!existsSync(abs)) return null;
    return readFileSync(abs, "utf-8");
  } catch {
    return null;
  }
};

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

// Editing an existing comment goes through `gh api`, not `gh pr`, so the prose
// regex alone would miss it. Without this arm, a walkthrough could be replaced
// with hand-written markdown after the fact — the update path becoming the way
// around the renderer that the post path already blocks.
function isCommentEditCommand(cmd: string): boolean {
  return GH_API_CMD.test(cmd) && ISSUE_COMMENT_PATH.test(cmd) && PATCH_METHOD.test(cmd);
}

/** Whether a Bash command publishes PR prose — a new comment/PR/description, or an edit to an existing comment. */
export function isPrReportPostCommand(cmd: string): boolean {
  return PR_PROSE_CMD.test(cmd) || isCommentEditCommand(cmd);
}

/**
 * Everything a `gh` publish command's body can be read from: the command string
 * itself (inline `--body`, `-b`, echo/heredoc/printf bodies) plus any readable
 * `--body-file` / `--input` path and any `.json` a `jq` pipe reads — the
 * sanctioned build-pr-section artifact, whose `{body,comment}` carry the sentinel.
 *
 * Output shape: the command text with each resolved file's contents appended,
 * newline-separated.
 */
export function collectPrPostText(
  cmd: string,
  cwd: string | undefined,
  read: FileReader,
): string {
  let text = cmd;
  for (const match of cmd.matchAll(/(?:--body-file|--input)[=\s]+("[^"]+"|'[^']+'|\S+)/g)) {
    const path = unquote(match[1]);
    if (path && path !== "-") {
      const contents = read(path, cwd);
      if (contents) text += "\n" + contents;
    }
  }
  for (const match of cmd.matchAll(/jq\b[^|]*?("[^"]+\.json"|'[^']+\.json'|\S+\.json)/g)) {
    const contents = read(unquote(match[1]), cwd);
    if (contents) text += "\n" + contents;
  }
  return text;
}
