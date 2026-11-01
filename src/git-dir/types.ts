/** Where a working tree's git state lives: its own directory (HEAD) and the directory it shares with every linked worktree (config, refs). */
export interface GitDirLocation {
  gitDir: string;
  commonDir: string;
}

/** Reads a file as text, or null when it is missing or unreadable — a directory included. */
export type ReadTextFile = (path: string) => string | null;
