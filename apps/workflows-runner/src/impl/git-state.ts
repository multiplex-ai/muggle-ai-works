import { runShell } from './shell.js';

export interface GitState {
  branch: string;
  diff: string;
  changedFiles: string[];
}

/**
 * Detects the default branch for a repo.
 * First tries `git symbolic-ref refs/remotes/origin/HEAD --short` (e.g. "origin/main"),
 * strips the "origin/" prefix. Falls back to checking whether "main" or "master" exist.
 */
export async function getDefaultBranch(repoPath: string): Promise<string> {
  const { exitCode, output } = await runShell(
    'git symbolic-ref refs/remotes/origin/HEAD --short',
    repoPath,
  );
  if (exitCode === 0) {
    const ref = output.trim();
    // ref is typically "origin/main" — strip the remote prefix
    const slash = ref.indexOf('/');
    if (slash !== -1) return ref.slice(slash + 1);
    return ref;
  }

  // Fallback: check if "main" or "master" exist locally
  for (const candidate of ['main', 'master']) {
    const { exitCode: rc } = await runShell(
      `git rev-parse --verify ${candidate}`,
      repoPath,
    );
    if (rc === 0) return candidate;
  }

  // Last resort
  return 'main';
}

/** Returns the current branch name in a repo. Throws in detached HEAD state. */
async function currentBranch(repoPath: string): Promise<string> {
  const { output } = await runShell('git branch --show-current', repoPath);
  const branch = output.trim();
  if (!branch) {
    throw new Error(
      'Not on a named branch (detached HEAD). Check out a feature branch before running muggle.',
    );
  }
  return branch;
}

/**
 * Returns files changed relative to the default branch.
 * Falls back to listing all tracked-but-modified files if no merge base exists.
 */
export async function getChangedFiles(repoPath: string): Promise<string[]> {
  const base = await getDefaultBranch(repoPath);
  const { exitCode, output } = await runShell(
    `git diff --name-only ${base}...HEAD`,
    repoPath,
  );
  if (exitCode === 0) {
    return output.split('\n').map((f) => f.trim()).filter(Boolean);
  }
  // Fallback: uncommitted changes in working tree
  const { output: fallback } = await runShell('git diff --name-only HEAD', repoPath);
  return fallback.split('\n').map((f) => f.trim()).filter(Boolean);
}

/**
 * Returns the full diff of changes relative to the default branch.
 */
async function getDiff(repoPath: string): Promise<string> {
  const base = await getDefaultBranch(repoPath);
  const { exitCode, output } = await runShell(`git diff ${base}...HEAD`, repoPath);
  if (exitCode === 0) return output;
  const { output: fallback } = await runShell('git diff HEAD', repoPath);
  return fallback;
}

/** Reads the current branch, diff, and changed files for a repo. */
export async function readGitState(repoPath: string): Promise<GitState> {
  const [branch, diff, changedFiles] = await Promise.all([
    currentBranch(repoPath),
    getDiff(repoPath),
    getChangedFiles(repoPath),
  ]);
  return { branch, diff, changedFiles };
}
