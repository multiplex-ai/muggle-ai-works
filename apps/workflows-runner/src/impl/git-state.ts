import { runShell } from './shell.js';

export interface GitState {
  branch: string;
  diff: string;
  changedFiles: string[];
}

/** Returns the current branch name in a repo. */
async function currentBranch(repoPath: string): Promise<string> {
  const { output } = await runShell('git branch --show-current', repoPath);
  return output.trim();
}

/**
 * Returns files changed relative to the default branch (main or master).
 * Falls back to listing all tracked-but-modified files if no merge base exists.
 */
export async function getChangedFiles(repoPath: string): Promise<string[]> {
  // Try main, then master as the base
  for (const base of ['main', 'master']) {
    const { exitCode, output } = await runShell(
      `git diff --name-only ${base}...HEAD`,
      repoPath,
    );
    if (exitCode === 0) {
      return output.split('\n').map((f) => f.trim()).filter(Boolean);
    }
  }
  // Fallback: uncommitted changes in working tree
  const { output } = await runShell('git diff --name-only HEAD', repoPath);
  return output.split('\n').map((f) => f.trim()).filter(Boolean);
}

/**
 * Returns the full diff of changes relative to the default branch.
 */
async function getDiff(repoPath: string): Promise<string> {
  for (const base of ['main', 'master']) {
    const { exitCode, output } = await runShell(`git diff ${base}...HEAD`, repoPath);
    if (exitCode === 0) return output;
  }
  const { output } = await runShell('git diff HEAD', repoPath);
  return output;
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
