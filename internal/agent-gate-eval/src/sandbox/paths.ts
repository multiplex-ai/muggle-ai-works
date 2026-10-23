/**
 * Path rules of a run's sandbox. The session's home directory is the
 * sandbox's: `~`, `$HOME`, and the real home directory all resolve under
 * `home`, and a relative path resolves in `repo`. Two real trees often sit
 * under the real home and keep their paths: the sandbox itself (the OS temp
 * dir is under the home on Windows) and the passthrough roots, such as the
 * plugin checkout.
 */

import * as path from "node:path";

import { HOME_PATH_PREFIXES } from "../constants.js";
import { SandboxPathToken, type RunSandbox, type SandboxPathContext } from "../types.js";

/** `text` with every `{{home}}` and `{{repo}}` replaced by this run's sandbox home and repo. */
export function fillSandboxPathTokens(text: string, sandbox: RunSandbox): string {
  return text.replaceAll(SandboxPathToken.Home, sandbox.home).replaceAll(SandboxPathToken.Repo, sandbox.repo);
}

/** True when `candidate` is `directory` or inside it; case-insensitive where the platform's paths are. */
export function isInsideDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** The rest of `filePath` after a leading home spelling (`~/x` → `x`), or null when it opens with none. */
function pathAfterHomePrefix(filePath: string): string | null {
  // A backslash separates path segments only on Windows; elsewhere `~\x` is a
  // relative file whose name starts with "~\", not a home path.
  const separators = path.sep === "\\" ? ["/", "\\"] : ["/"];
  for (const prefix of HOME_PATH_PREFIXES) {
    if (filePath === prefix) return "";
    if (separators.some((separator) => filePath.startsWith(`${prefix}${separator}`))) {
      return filePath.slice(prefix.length + 1);
    }
  }
  return null;
}

/**
 * Where a path a session names lands in the sandbox.
 *
 * Output shape: an absolute path — `~/.muggle-ai/x` and `<real home>/.muggle-ai/x`
 * become `<sandbox home>/.muggle-ai/x`, `src/app.js` becomes `<sandbox repo>/src/app.js`,
 * and any other absolute path — one in the sandbox or a passthrough root among
 * them — is returned resolved but unmoved.
 */
export function resolveSandboxPath(filePath: string, paths: SandboxPathContext): string {
  const afterHome = pathAfterHomePrefix(filePath);
  if (afterHome !== null) return path.join(paths.home, afterHome);
  const absolute = path.resolve(paths.repo, filePath);
  // A relative path climbing out of the repo is not a home path the session named.
  if (!path.isAbsolute(filePath)) return absolute;
  const isRealPath = [paths.root, ...paths.passthroughRoots].some((realRoot) => isInsideDirectory(realRoot, absolute));
  if (!isRealPath && isInsideDirectory(paths.realHome, absolute)) {
    return path.join(paths.home, path.relative(paths.realHome, absolute));
  }
  return absolute;
}

/** Path text in one comparable form: forward slashes, no repeats, and lower case where paths are case-insensitive. */
export function normalizePathText(text: string): string {
  const slashed = text.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return process.platform === "win32" ? slashed.toLowerCase() : slashed;
}

/**
 * Every way a shell command can name one sandbox path, normalized: its
 * sandbox spelling, and for a path in the sandbox home its real-home, `~` and
 * `$HOME` spellings, plus the spelling the scenario wrote.
 */
export function sandboxPathSpellings(
  writtenPath: string,
  paths: SandboxPathContext,
): string[] {
  const sandboxPath = resolveSandboxPath(writtenPath, paths);
  const spellings = [sandboxPath, writtenPath];
  if (isInsideDirectory(paths.home, sandboxPath)) {
    const inHome = path.relative(paths.home, sandboxPath);
    spellings.push(path.join(paths.realHome, inHome));
    for (const prefix of HOME_PATH_PREFIXES) spellings.push(`${prefix}/${inHome}`);
  }
  return Array.from(new Set(spellings.map(normalizePathText)));
}
