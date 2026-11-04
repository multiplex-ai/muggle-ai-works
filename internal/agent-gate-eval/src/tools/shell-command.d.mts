import type { ChainedCommand } from "../types.js";

/**
 * The commands a chained shell command runs in turn: split on `&&`, `||`, `;`
 * and newlines outside quotes and parentheses. A command with a heredoc, or
 * whose quotes or parentheses never close, comes back whole.
 *
 * Output shape: `chainedCommands("cd repo && git status; ls")` →
 * `[{ command: "cd repo", isConditional: false }, { command: "git status", isConditional: true }, { command: "ls", isConditional: false }]`.
 */
export function chainedCommands(command: string): ChainedCommand[];

/** A command stage's words, quotes removed; null when its quoting does not close. */
export function shellWords(text: string): string[] | null;

/**
 * What one command of a chain prints when the shell alone decides it: nothing
 * for a `cd`, a bare assignment or a conditional `echo`, and the words of an
 * unconditional `echo` of plain literals. Undefined for any other command,
 * whose output only a stub can say.
 *
 * Output shape: `builtinOutput({ command: 'echo "--- stat"', isConditional: false })` → `"--- stat"`.
 */
export function builtinOutput(chained: ChainedCommand): string | undefined;
