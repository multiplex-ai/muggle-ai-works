/** The entry a working tree keeps at its root: a directory, or in a linked worktree a file pointing at one. */
export const DOT_GIT = ".git";

/** A linked worktree's `.git` file: `gitdir: <path to its directory under the main repo's .git/worktrees>`. */
export const GITDIR_POINTER = /^gitdir:\s*(.+?)\s*$/m;

/** A HEAD file on a branch: `ref: refs/heads/<branch>`. Anything else in HEAD is a detached commit. */
export const HEAD_BRANCH_REF = /^ref:\s*refs\/heads\/(.+?)\s*$/;

/** A symbolic remote HEAD, e.g. `refs/remotes/origin/HEAD`: `ref: refs/remotes/<remote>/<branch>`. */
export const REMOTE_HEAD_REF = /^ref:\s*refs\/remotes\/(.+?)\s*$/;

/** A config section header, with an optional quoted subsection: `[remote "origin"]`. */
export const CONFIG_SECTION_HEADER = /^\s*\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\]/;

/** A config `key = value` line; the value runs to an unquoted comment marker. */
export const CONFIG_KEY_VALUE = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*)$/;

/**
 * Config that can make git report a remote URL other than the one written in the remote's section:
 * a URL rewrite, or a file included from elsewhere. Either sends the lookup back to git itself.
 */
export const CONFIG_INDIRECTION = /^\s*(?:\[\s*include(?:If)?\b|[^#;]*\binsteadOf\s*=)/im;
