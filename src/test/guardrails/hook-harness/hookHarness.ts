import { spawnSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, join } from "path";
import type { GuardrailState } from "../../../guardrails/types.js";
import { commandsForSlot, loadHooksManifest } from "../footprint/footprint.js";
import type { HookSlot } from "../footprint/types.js";
import { PLUGIN_SCRIPTS_DIR } from "../support/constants.js";
import {
  GUARDRAIL_CLI_ENTRY,
  GUARDRAIL_DISPATCH_WRAPPER,
  GUARDRAIL_STATE_PATH_SEGMENTS,
  GUARDRAIL_SUBCOMMAND_ASSIGNMENT,
  GUARDRAIL_WRAPPER_SCRIPT,
  MUGGLE_DO_SESSIONS_PATH_SEGMENTS,
  TSX_LOADER_URL,
  WALKTHROUGH_PROBE_BRANCH_PR_URL_ENV,
  WALKTHROUGH_PROBE_GH_STUB_BODY,
  WALKTHROUGH_PROBE_PR_CONTENT_ENV,
  WINDOWS_GH_EXECUTABLES,
} from "./constants.js";
import type { GuardrailCliInvocation, GuardrailCliRun, WalkthroughProbeAnswers } from "./types.js";

/** A throwaway directory standing in for HOME, so a hook run never touches the real ~/.muggle-ai. */
export function createHookHome(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Runs the guardrails CLI the way a hook command does: the event payload on stdin, the subcommand in argv, the
 * answer on stdout. HOME is redirected because session state persists under `os.homedir()`.
 */
export function runGuardrailCli(invocation: GuardrailCliInvocation): GuardrailCliRun {
  const cliProcess = spawnSync(
    process.execPath,
    ["--import", TSX_LOADER_URL, GUARDRAIL_CLI_ENTRY, ...invocation.cliArgs],
    {
      input: invocation.stdin,
      encoding: "utf-8",
      env: { ...(invocation.env ?? process.env), HOME: invocation.home, USERPROFILE: invocation.home },
      windowsHide: true,
    },
  );
  return { status: cliProcess.status, stdout: (cliProcess.stdout ?? "").trim() };
}

/** Path of a session's guardrail state file under `home`. */
export function guardrailStateFile(home: string, sessionId: string): string {
  return join(home, ...GUARDRAIL_STATE_PATH_SEGMENTS, `${sessionId}.json`);
}

/**
 * Seeds the state file earlier hooks in the session would have left. Pretty-printed like the CLI writes it,
 * because the bash wrappers' pre-filters match its exact spacing.
 */
export function writeGuardrailState(
  home: string,
  state: Partial<GuardrailState> & Pick<GuardrailState, "sessionId">,
): void {
  mkdirSync(join(home, ...GUARDRAIL_STATE_PATH_SEGMENTS), { recursive: true });
  writeFileSync(guardrailStateFile(home, state.sessionId), JSON.stringify(state, null, 2));
}

/** A muggle-do session slot's directory under `home`. */
export function sessionSlotDirectory(home: string, slug: string): string {
  return join(home, ...MUGGLE_DO_SESSIONS_PATH_SEGMENTS, slug);
}

/**
 * Writes files into a muggle-do session slot, creating the slot first.
 * @param slotFiles - File name to contents, e.g. `{ "prs.json": "[...]" }`.
 * @returns The slot's directory.
 */
export function writeSessionSlotFiles(home: string, slug: string, slotFiles: Record<string, string>): string {
  const slotDirectory = sessionSlotDirectory(home, slug);
  mkdirSync(slotDirectory, { recursive: true });
  for (const [fileName, contents] of Object.entries(slotFiles)) writeFileSync(join(slotDirectory, fileName), contents);
  return slotDirectory;
}

/**
 * A fresh directory holding one executable bash stand-in named `programName`, to put first on PATH.
 * POSIX only: Windows will not run a script for a bare program name.
 */
export function createStubProgramDirectory(programName: string, bashBody: string): string {
  const stubDirectory = mkdtempSync(join(tmpdir(), `gr-stub-${programName}-`));
  const stubPath = join(stubDirectory, programName);
  writeFileSync(stubPath, `#!/usr/bin/env bash\n${bashBody}`);
  chmodSync(stubPath, 0o755);
  return stubDirectory;
}

/** A `gh` stand-in answering the walkthrough gate's provider reads from env, so each run supplies its own answers. */
export function createWalkthroughProbeGhStub(): string {
  return createStubProgramDirectory("gh", WALKTHROUGH_PROBE_GH_STUB_BODY);
}

/** The env entries the walkthrough-probe `gh` stub reads its answers from. */
export function walkthroughProbeAnswerEnvironment(answers: WalkthroughProbeAnswers): NodeJS.ProcessEnv {
  return {
    [WALKTHROUGH_PROBE_BRANCH_PR_URL_ENV]: answers.branchPrUrl,
    [WALKTHROUGH_PROBE_PR_CONTENT_ENV]: answers.prContentJson,
  };
}

/** The current PATH with `directory` searched first. */
export function pathWithDirectoryFirst(directory: string): string {
  return `${directory}${delimiter}${process.env.PATH ?? ""}`;
}

/**
 * The current environment, changed so `gh` can never reach a provider — including from the detached jobs a hook
 * starts, which inherit it. On POSIX the stub in `ghStubDirectory` shadows `gh`. Windows resolves a bare `gh` only
 * to an .exe or .com, which no script can stand in for, so there every directory holding one leaves PATH instead
 * and a lookup fails the way an offline one does.
 */
export function providerFreeEnvironment(ghStubDirectory: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  let searchPath = "";
  // Windows spells it Path, and a copy carrying two spellings leaves which one the child sees undefined.
  for (const [name, value] of Object.entries(process.env)) {
    if (name.toUpperCase() === "PATH") searchPath = value ?? "";
    else environment[name] = value;
  }
  const searchDirectories = searchPath.split(delimiter).filter((directory) => directory.length > 0);
  environment.PATH =
    process.platform === "win32"
      ? searchDirectories
          .filter((directory) => !WINDOWS_GH_EXECUTABLES.some((executable) => existsSync(join(directory, executable))))
          .join(delimiter)
      : [ghStubDirectory, ...searchDirectories].join(delimiter);
  return environment;
}

/**
 * The CLI subcommands Claude Code reaches when `slot` fires, read from plugin/hooks/hooks.json through each gate
 * wrapper's GUARDRAIL_SUBCOMMAND, so a gate registered there is covered the moment it exists.
 * @throws When a registered wrapper names no subcommand: a gate that cannot be reached cannot be vouched for.
 *
 * Output shape: `["pr-opened", "record-tests", "pr-terminal"]`
 */
export function guardrailSubcommandsForSlot(slot: HookSlot): string[] {
  const wrapperNames = commandsForSlot(loadHooksManifest(), slot)
    .flatMap((hookCommand) => hookCommand.command.match(GUARDRAIL_WRAPPER_SCRIPT) ?? [])
    .filter((wrapperName) => wrapperName !== GUARDRAIL_DISPATCH_WRAPPER);
  const subcommands = wrapperNames.map((wrapperName) => {
    const wrapperBody = readFileSync(join(PLUGIN_SCRIPTS_DIR, wrapperName), "utf-8");
    const subcommand = GUARDRAIL_SUBCOMMAND_ASSIGNMENT.exec(wrapperBody)?.[1];
    if (!subcommand) throw new Error(`${wrapperName} names no GUARDRAIL_SUBCOMMAND`);
    return subcommand;
  });
  return [...new Set(subcommands)];
}
