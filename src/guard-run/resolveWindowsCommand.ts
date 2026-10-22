import { extname } from "node:path";
import { WINDOWS_SHELL_SCRIPT_EXTENSIONS } from "./constants.js";

function isShellScript(path: string): boolean {
  return WINDOWS_SHELL_SCRIPT_EXTENSIONS.includes(extname(path).toLowerCase());
}

/**
 * Whether the command's first token resolves to a .cmd/.bat script, which CreateProcess cannot run without cmd.exe.
 *
 * `whereOutput` is `where.exe <token>` stdout, or null when the lookup found nothing. Candidates without an extension
 * are skipped: CreateProcess never runs them, and npm writes one (a POSIX shim) beside every .cmd it installs, which
 * `where.exe` lists first.
 */
export function windowsCommandNeedsCmdShell(args: { firstCommandToken: string; whereOutput: string | null }): boolean {
  if (extname(args.firstCommandToken) !== "") return isShellScript(args.firstCommandToken);
  const launchableCandidate = (args.whereOutput ?? "")
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => extname(candidate) !== "");
  return launchableCandidate !== undefined && isShellScript(launchableCandidate);
}
