import { basename } from "path";

// The characters of the separators that start a new command: `a && b`, `a; b`, `a | b`, a newline.
const SHELL_COMMAND_SEPARATOR = /[;&|\n]/;

// A backslash escapes only the characters the shell gives meaning to, so a
// Windows path (`C:\Users\…`) keeps its separators.
const SHELL_ESCAPABLE_UNQUOTED = new Set([" ", "\t", "'", '"', "\\", "$", ";", "&", "|", "\n"]);
const SHELL_ESCAPABLE_DOUBLE_QUOTED = new Set(['"', "\\", "$", "`"]);

/**
 * A shell command split into its simple commands, each as its words with quotes removed.
 *
 * A best-effort reading, not a shell: quotes group words and separators split
 * commands, which is all the guardrails' command checks need. Substitutions and
 * redirections pass through as ordinary words.
 *
 * Output shape: `splitShellCommands("cd /p && cat 'a b.md'")` → `[["cd", "/p"], ["cat", "a b.md"]]`
 */
export function splitShellCommands(command: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let wordStarted = false;
  let quote: string | null = null;
  const endWord = (): void => {
    if (wordStarted) words.push(word);
    word = "";
    wordStarted = false;
  };
  const endCommand = (): void => {
    endWord();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const nextCharacter = command[index + 1];
    if (quote !== null) {
      if (character === quote) {
        quote = null;
      } else if (character === "\\" && quote === '"' && SHELL_ESCAPABLE_DOUBLE_QUOTED.has(nextCharacter)) {
        word += nextCharacter;
        index += 1;
      } else {
        word += character;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      wordStarted = true;
    } else if (character === "\\" && SHELL_ESCAPABLE_UNQUOTED.has(nextCharacter)) {
      word += nextCharacter;
      wordStarted = true;
      index += 1;
    } else if (SHELL_COMMAND_SEPARATOR.test(character)) {
      endCommand();
    } else if (/\s/.test(character)) {
      endWord();
    } else {
      word += character;
      wordStarted = true;
    }
  }
  endCommand();
  return commands;
}

/** A command word as the program it runs: no directory, lowercased, no `.exe`, so `C:\Git\bin\Cat.exe` is `cat`. */
export function normalizeProgramName(programWord: string): string {
  return basename(programWord.replaceAll("\\", "/")).toLowerCase().replace(/\.exe$/, "");
}
