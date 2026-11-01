import { dirname, join, resolve } from "path";
import {
  CONFIG_INDIRECTION,
  CONFIG_KEY_VALUE,
  CONFIG_SECTION_HEADER,
  DOT_GIT,
  GITDIR_POINTER,
  HEAD_BRANCH_REF,
  REMOTE_HEAD_REF,
} from "./constants.js";
import type { GitDirLocation, ReadTextFile } from "./types.js";

// Each lookup here answers from a file read, which costs microseconds, where
// spawning git costs tens of milliseconds idle and over half a second on a
// loaded Windows box — longer than a hook's whole child-process allowance.
// A null answer means "ask git": the reader never guesses past what the files
// say plainly.

/**
 * The git directories of the working tree containing `cwd`, found by walking up to the nearest `.git`.
 * @returns null when no enclosing `.git` is readable.
 */
export function locateGitDir(cwd: string, readTextFile: ReadTextFile): GitDirLocation | null {
  let dir = resolve(cwd);
  for (;;) {
    const dotGit = join(dir, DOT_GIT);
    const pointer = readTextFile(dotGit)?.match(GITDIR_POINTER);
    const gitDir = pointer ? resolve(dir, pointer[1]) : readTextFile(join(dotGit, "HEAD")) !== null ? dotGit : null;
    if (gitDir) {
      const commonDirPointer = readTextFile(join(gitDir, "commondir"))?.trim();
      return { gitDir: gitDir, commonDir: commonDirPointer ? resolve(gitDir, commonDirPointer) : gitDir };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The branch checked out in the working tree containing `cwd`, as `git branch --show-current` prints it.
 * @returns the branch; `""` when HEAD is detached; null when HEAD could not be read.
 */
export function readCurrentBranch(cwd: string, readTextFile: ReadTextFile): string | null {
  const location = locateGitDir(cwd, readTextFile);
  const head = location ? readTextFile(join(location.gitDir, "HEAD")) : null;
  if (head === null) return null;
  return head.match(HEAD_BRANCH_REF)?.[1] ?? "";
}

function parseConfigValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.startsWith('"')) {
    const closingQuote = value.slice(1).search(/(?<!\\)"/);
    const quoted = closingQuote < 0 ? value.slice(1) : value.slice(1, closingQuote + 1);
    return quoted.replace(/\\(["\\])/g, "$1");
  }
  return value.replace(/\s*[#;].*$/, "");
}

/**
 * The URL configured for `remote`, as `git remote get-url <remote>` prints it.
 * @returns null when the config is unreadable, names no URL for the remote, or rewrites or includes config git
 *   would apply, so the written URL might not be the one git reports.
 */
export function readRemoteUrl(cwd: string, remote: string, readTextFile: ReadTextFile): string | null {
  const location = locateGitDir(cwd, readTextFile);
  const config = location ? readTextFile(join(location.commonDir, "config")) : null;
  if (config === null || CONFIG_INDIRECTION.test(config)) return null;
  let isInRemoteSection = false;
  for (const line of config.split(/\r?\n/)) {
    const header = line.match(CONFIG_SECTION_HEADER);
    if (header) {
      isInRemoteSection = header[1].toLowerCase() === "remote" && header[2] === remote;
      continue;
    }
    const entry = isInRemoteSection ? line.match(CONFIG_KEY_VALUE) : null;
    if (entry && entry[1].toLowerCase() === "url") return parseConfigValue(entry[2]) || null;
  }
  return null;
}

/**
 * The branch `refs/remotes/<remote>/HEAD` points at, as `git symbolic-ref refs/remotes/<remote>/HEAD --short` prints it.
 *
 * Output shape: `"origin/master"`
 * @returns null when the ref file is absent or is not symbolic.
 */
export function readRemoteHeadBranch(cwd: string, remote: string, readTextFile: ReadTextFile): string | null {
  const location = locateGitDir(cwd, readTextFile);
  const ref = location ? readTextFile(join(location.commonDir, "refs", "remotes", remote, "HEAD")) : null;
  return ref?.match(REMOTE_HEAD_REF)?.[1] ?? null;
}
