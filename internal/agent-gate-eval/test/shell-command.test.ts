import { describe, expect, it } from "vitest";

import { builtinOutput, chainedCommands, shellWords } from "../src/tools/shell-command.mjs";
import type { ChainedCommand } from "../src/types.js";

const runsAlways = (command: string): ChainedCommand => ({ command: command, isConditional: false });
const commandsOf = (command: string): string[] => chainedCommands(command).map((chained) => chained.command);

describe("chainedCommands", () => {
  it("splits on &&, ||, ; and newlines", () => {
    expect(commandsOf("cd repo && git status || true; ls\ngit log -1")).toEqual([
      "cd repo",
      "git status",
      "true",
      "ls",
      "git log -1",
    ]);
  });

  it("keeps pipes, redirects and a lone & inside one command", () => {
    expect(commandsOf("git log | head -3 2>&1 && gh pr view 7 > out.json")).toEqual([
      "git log | head -3 2>&1",
      "gh pr view 7 > out.json",
    ]);
  });

  it("never splits inside quotes, backticks or parentheses", () => {
    expect(commandsOf(`gh pr comment 7 --body "a && b; c" && echo 'x || y'`)).toEqual([
      `gh pr comment 7 --body "a && b; c"`,
      "echo 'x || y'",
    ]);
    expect(commandsOf("git push origin $(git branch --show-current; echo) && echo `date; whoami`")).toEqual([
      "git push origin $(git branch --show-current; echo)",
      "echo `date; whoami`",
    ]);
  });

  it("joins an escaped separator or a line continuation to its command", () => {
    expect(commandsOf("find . -exec rm {} \\; && gh pr view \\\n  7")).toEqual([
      "find . -exec rm {} \\;",
      "gh pr view \\\n  7",
    ]);
  });

  it("marks the commands that follow && or ||, a line break after the operator included", () => {
    expect(chainedCommands("kill -0 42 && echo alive || echo dead; echo ---\nls &&\n  echo listed")).toEqual([
      { command: "kill -0 42", isConditional: false },
      { command: "echo alive", isConditional: true },
      { command: "echo dead", isConditional: true },
      { command: "echo ---", isConditional: false },
      { command: "ls", isConditional: false },
      { command: "echo listed", isConditional: true },
    ]);
  });

  it("drops the empty commands a trailing or doubled separator leaves", () => {
    expect(commandsOf("git status;;\n\n")).toEqual(["git status"]);
  });

  it("returns a command with a heredoc, or unclosed quoting, whole", () => {
    const heredoc = "git commit -F - <<'EOF'\nfix: a; b\nEOF\ngit push";
    expect(commandsOf(heredoc)).toEqual([heredoc]);
    expect(commandsOf(`echo "open && still open`)).toEqual([`echo "open && still open`]);
    expect(commandsOf("echo $(date && whoami")).toEqual(["echo $(date && whoami"]);
  });
});

describe("shellWords", () => {
  it("splits on unquoted whitespace and drops the quotes", () => {
    expect(shellWords(`cat "a b.md" 'c d' e`)).toEqual(["cat", "a b.md", "c d", "e"]);
    expect(shellWords(`cat "open`)).toBeNull();
  });
});

describe("builtinOutput", () => {
  it("prints nothing for a cd or a bare assignment, captured command and all", () => {
    expect(builtinOutput(runsAlways('cd "/tmp/run/repo"'))).toBe("");
    expect(builtinOutput(runsAlways('SLOT_DIR="/home/.muggle-ai/muggle-do/sessions/pr504"'))).toBe("");
    expect(builtinOutput(runsAlways('body="$(bash sign-body.sh --mode loop < reply.md)"'))).toBe("");
    expect(builtinOutput(runsAlways("BODY=$(curl -sS --max-time 3 http://localhost:3999/)"))).toBe("");
    expect(builtinOutput(runsAlways("export BASE=main HEAD_SHA=9f2c1e4"))).toBe("");
  });

  it("prints the words of an echo of literals", () => {
    expect(builtinOutput(runsAlways("echo ---"))).toBe("---");
    expect(builtinOutput(runsAlways('echo "--- untracked:"'))).toBe("--- untracked:");
    expect(builtinOutput(runsAlways("echo  check   ok"))).toBe("check ok");
    expect(builtinOutput(runsAlways("echo"))).toBe("");
  });

  it("prints nothing for an echo that runs only on an exit status", () => {
    expect(builtinOutput({ command: "echo alive", isConditional: true })).toBe("");
  });

  it("leaves every other command to the stubs", () => {
    for (const command of [
      "git status",
      "FOO=bar make build",
      'echo "SESSION_ID=${CLAUDE_CODE_SESSION_ID:-unset}"',
      'echo "exit=$?"',
      "echo -n done",
      "echo done > out.txt",
      "echo *.json",
    ]) {
      expect(builtinOutput(runsAlways(command)), command).toBeUndefined();
    }
  });
});
