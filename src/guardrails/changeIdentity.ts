import { defaultSkipProbes } from "../e2e-skip/probes.js";
import type { SkipProbes } from "../e2e-skip/types.js";
import {
  CHANGE_REPO_REMOTE,
  DIRECTORY_CHANGE_COMMAND,
  GITHUB_PR_URL,
  GITLAB_MR_URL,
  PR_HEAD_BRANCH_FLAG,
  PR_OPEN_COMMAND,
} from "./constants.js";
import type { ChangeIdentity } from "./types.js";

function toRepoKey(host: string, path: string): string | undefined {
  const repoPath = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  return host && repoPath ? `${host}/${repoPath}`.toLowerCase() : undefined;
}

/**
 * The repo a PR or MR web URL belongs to, keyed the way {@link repoKeyOfRemoteUrl} keys a remote.
 *
 * Output shape: `"github.com/acme/web"`, `"gitlab.example.com/group/sub/web"`
 */
export function repoKeyOfPrUrl(prUrl: string): string | undefined {
  const pullsAt = prUrl.match(GITHUB_PR_URL) ? prUrl.indexOf("/pull/") : prUrl.match(GITLAB_MR_URL) ? prUrl.indexOf("/-/merge_requests/") : -1;
  if (pullsAt < 0) return undefined;
  try {
    const repoUrl = new URL(prUrl.slice(0, pullsAt));
    return toRepoKey(repoUrl.hostname, repoUrl.pathname);
  } catch {
    return undefined;
  }
}

/**
 * The repo a git remote URL points at — https, `ssh://`, or scp-style `git@host:path`.
 *
 * Output shape: `"github.com/acme/web"`
 */
export function repoKeyOfRemoteUrl(remoteUrl: string): string | undefined {
  const trimmedUrl = remoteUrl.trim();
  const scpStyle = trimmedUrl.match(/^[^@\s/]+@([^:\s/]+):(?!\/)(.+)$/);
  if (scpStyle) return toRepoKey(scpStyle[1], scpStyle[2]);
  try {
    const parsedUrl = new URL(trimmedUrl);
    return toRepoKey(parsedUrl.hostname, parsedUrl.pathname);
  } catch {
    return undefined;
  }
}

/** The change a working tree holds: its origin's repo and its checked-out branch; undefined when either is unreadable or HEAD is detached. */
export function resolveTreeChange(
  cwd: string | undefined,
  runGit: SkipProbes["runGit"] = defaultSkipProbes.runGit,
): ChangeIdentity | undefined {
  if (!cwd) return undefined;
  const remoteUrl = runGit(["remote", "get-url", CHANGE_REPO_REMOTE], cwd);
  const repo = remoteUrl ? repoKeyOfRemoteUrl(remoteUrl) : undefined;
  const branch = runGit(["branch", "--show-current"], cwd)?.trim();
  return repo && branch ? { repo: repo, branch: branch } : undefined;
}

/**
 * The change a just-opened PR belongs to, or undefined when its head branch cannot be known for certain.
 *
 * The repo is the PR URL's, so `--repo` cannot misattribute it. The branch is
 * the command's head flag; without one, `gh`/`glab` used the branch of the
 * directory they ran in, which is the hook's working tree only when the
 * command never left it and that tree is in the PR's repo.
 */
export function resolveOpenedPrChange(
  command: string,
  prUrl: string,
  cwd: string | undefined,
  runGit: SkipProbes["runGit"] = defaultSkipProbes.runGit,
): ChangeIdentity | undefined {
  const repo = repoKeyOfPrUrl(prUrl);
  if (!repo) return undefined;
  const openAt = command.search(PR_OPEN_COMMAND);
  const headFlag = openAt < 0 ? null : command.slice(openAt).match(PR_HEAD_BRANCH_FLAG);
  if (headFlag) return { repo: repo, branch: headFlag[1].slice(headFlag[1].lastIndexOf(":") + 1) };
  if (DIRECTORY_CHANGE_COMMAND.test(command)) return undefined;
  const treeChange = resolveTreeChange(cwd, runGit);
  return treeChange?.repo === repo ? treeChange : undefined;
}

/** Whether two changes are the same repo and branch; an unknown side is never the same. */
export function isSameChange(left: ChangeIdentity | undefined, right: ChangeIdentity | undefined): boolean {
  return left !== undefined && right !== undefined && left.repo === right.repo && left.branch === right.branch;
}
