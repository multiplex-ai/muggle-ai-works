import type { HookInput } from "./types.js";
import {
  MUGGLE_E2E_RUN_TOOL,
  MUGGLE_SKILL_EMIT_TOOL,
  MUGGLE_TEST_SKILL_NAME,
  PACKAGE_EXEC_SUBCOMMANDS,
  PACKAGE_MANAGER_PROGRAMS,
  PACKAGE_RUNNER_PROGRAMS,
  PYTHON_PROGRAMS,
  SCRIPT_SHELL_FLAGS,
  SCRIPT_SHELL_PROGRAMS,
  SHELL_ASSIGNMENT,
  TEST_RUNNER_PROGRAMS,
  TEST_SUBCOMMAND_PROGRAMS,
} from "./constants.js";
import { normalizeProgramName, splitShellCommands } from "./shellCommands.js";

const FAIL = /\b\d+\s+failed\b|\bFAIL\b|✗/;
const TEST_SCRIPT = /^test(:|$)/;
// A subshell or brace group keeps its bracket on the first and last word: `(cd x && pnpm test)`.
const GROUPING_BRACKETS = /^[({]+|[)}]+$/g;

/**
 * Whether a shell command runs a test suite.
 *
 * Judged per simple command by the program it runs, never by the text: a
 * read-only `cat vitest.config.ts` or a commit message saying "pnpm test" names
 * a runner without running it, and any output free of a failure marker would
 * then mark the session's unit tests green.
 */
export function isTestCommand(cmd: string): boolean {
  return splitShellCommands(cmd).some(runsTestSuite);
}

function runsTestSuite(commandWords: readonly string[]): boolean {
  const words = commandWords.map((word) => word.replace(GROUPING_BRACKETS, "")).filter((word) => word.length > 0);
  const programIndex = words.findIndex((word) => !SHELL_ASSIGNMENT.test(word));
  if (programIndex < 0) return false;
  const program = normalizeProgramName(words[programIndex]);
  const argumentWords = words.slice(programIndex + 1);
  const operandIndex = argumentWords.findIndex((word) => !word.startsWith("-"));
  const operand = operandIndex < 0 ? undefined : argumentWords[operandIndex];
  const afterOperand = operandIndex < 0 ? [] : argumentWords.slice(operandIndex + 1);

  if (TEST_RUNNER_PROGRAMS.includes(program)) return true;
  if (TEST_SUBCOMMAND_PROGRAMS.includes(program)) return operand === "test";
  if (PACKAGE_MANAGER_PROGRAMS.includes(program)) return runsPackageTestScript(operand, afterOperand);
  if (PACKAGE_RUNNER_PROGRAMS.includes(program)) return operand !== undefined && runsTestSuite([operand, ...afterOperand]);
  if (program === "env") return runsTestSuite(argumentWords);
  if (program === "timeout") return runsTestSuite(afterOperand);
  // `node guard-run.mjs -- pnpm vitest run`: the Stage 5 launch, which runs the suite under a process cap.
  if (program === "node") {
    const separatorIndex = argumentWords.indexOf("--");
    return separatorIndex >= 0 && runsTestSuite(argumentWords.slice(separatorIndex + 1));
  }
  if (PYTHON_PROGRAMS.includes(program)) {
    return argumentWords[0] === "-m" && TEST_RUNNER_PROGRAMS.includes(argumentWords[1] ?? "");
  }
  if (SCRIPT_SHELL_PROGRAMS.includes(program)) {
    const flagIndex = argumentWords.findIndex((word) => SCRIPT_SHELL_FLAGS.includes(word.toLowerCase()));
    const script = flagIndex < 0 ? undefined : argumentWords[flagIndex + 1];
    return script !== undefined && isTestCommand(script);
  }
  return false;
}

function runsPackageTestScript(subcommand: string | undefined, rest: readonly string[]): boolean {
  if (subcommand === undefined) return false;
  if (subcommand === "run") return TEST_SCRIPT.test(rest[0] ?? "");
  if (PACKAGE_EXEC_SUBCOMMANDS.includes(subcommand)) return runsTestSuite(rest.filter((word) => !word.startsWith("-")));
  return TEST_SCRIPT.test(subcommand) || TEST_RUNNER_PROGRAMS.includes(subcommand);
}

// `output` is where a host that reports combined output (Codex) puts both streams.
export function testsPassed(input: HookInput): boolean {
  const response = input.tool_response;
  const out = `${response?.stdout ?? ""}\n${response?.stderr ?? ""}\n${response?.output ?? ""}`;
  if (!out.trim()) return false;
  return !FAIL.test(out);
}

// An acceptance run registers two ways: a tool that starts a run (see
// MUGGLE_E2E_RUN_TOOL), or the muggle-test skill's own telemetry emit — the
// latter is what registers a clean SKIP verdict, where the skill ran but never
// reached an execute call (see MUGGLE_SKILL_EMIT_TOOL in constants.ts). Never
// the Bash command text: in a repo named "muggle", commits, PR titles and greps
// say "muggle … test" constantly, and a text match flipped e2eRun before any run.
export function isE2ERun(input: HookInput): boolean {
  if (MUGGLE_E2E_RUN_TOOL.test(input.tool_name ?? "")) return true;
  return (
    MUGGLE_SKILL_EMIT_TOOL.test(input.tool_name ?? "") &&
    input.tool_input?.skillName === MUGGLE_TEST_SKILL_NAME
  );
}
