#!/usr/bin/env node

/**
 * Runs one Muggle hook script under Git Bash for Codex on Windows.
 *
 * Codex hands a plugin hook's `commandWindows` to the session shell —
 * PowerShell by default, cmd.exe as a fallback — and neither can run the bash
 * scripts the guardrails are written in. So the generated command starts with
 * a bare `node`, which both shells parse alike (a quoted path in that position
 * is a PowerShell syntax error), and this finds Git Bash and runs the script
 * there with the hook's stdin and stdout, stamped as a Codex hook the way the
 * POSIX command's `env MUGGLE_HOOK_HOST=codex` is.
 *
 * With no Git Bash it prints `{}` and exits 0: the no-op every guardrail
 * degrades to, never a blocked turn. MUGGLE_HOOK_BASH names a bash.exe for an
 * install the search does not find.
 *
 * Usage: node codex-hook-windows.mjs "<plugin-root>/scripts/<script>.sh" [args...]
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { pathToFileURL } from "node:url";

/** The stamp that tells the guardrails a hook was fired by Codex. */
export const HOOK_HOST_STAMP = { MUGGLE_HOOK_HOST: "codex" };

/**
 * Where Git Bash may live, most specific first: the explicit override, beside
 * each git.exe on PATH, then the machine-wide and per-user install paths.
 * @param {Record<string, string | undefined>} env - The hook's environment.
 * @param {string[]} gitExecutables - git.exe paths, as `where git` lists them.
 * @returns {string[]} Candidate bash.exe paths.
 */
export function gitBashCandidates(env, gitExecutables) {
    const candidates = env.MUGGLE_HOOK_BASH ? [env.MUGGLE_HOOK_BASH] : [];
    for (const git of gitExecutables) {
        candidates.push(win32.join(win32.dirname(git), "..", "bin", "bash.exe"));
    }
    const installRoots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && win32.join(env.LOCALAPPDATA, "Programs")];
    for (const root of installRoots) {
        if (root) candidates.push(win32.join(root, "Git", "bin", "bash.exe"));
    }
    return candidates;
}

function gitExecutablesOnPath() {
    if (process.platform !== "win32") return [];
    try {
        return execFileSync("where", ["git"], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] })
            .split(/\r?\n/)
            .filter(Boolean);
    } catch {
        return [];
    }
}

/**
 * Run the hook script under the first Git Bash found, or answer `{}` without one.
 * @param {string[]} scriptAndArgs - The script path followed by its arguments.
 * @param {Record<string, string | undefined>} env - The hook's environment.
 * @returns {number} The exit code to end with.
 */
export function runHookUnderGitBash(scriptAndArgs, env = process.env) {
    const bash = gitBashCandidates(env, gitExecutablesOnPath()).find((candidate) => existsSync(candidate));
    if (!bash) {
        process.stdout.write("{}\n");
        return 0;
    }
    const run = spawnSync(bash, scriptAndArgs, { stdio: "inherit", env: { ...env, ...HOOK_HOST_STAMP } });
    if (run.error) {
        process.stdout.write("{}\n");
        return 0;
    }
    return run.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = runHookUnderGitBash(process.argv.slice(2));
}
