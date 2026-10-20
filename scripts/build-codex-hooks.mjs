#!/usr/bin/env node

/**
 * Generates plugin/hooks/codex-hooks.json from plugin/hooks/hooks.json.
 *
 * The Codex plugin manifest (plugin/.codex-plugin/plugin.json) points Codex at
 * the generated file. Codex runs Claude Code-format hooks, but two things differ
 * and both are written here rather than inferred at runtime:
 *
 * - Codex exports CLAUDE_PLUGIN_ROOT to plugin hooks for compatibility, so a
 *   guardrail cannot tell it from Claude Code. Every command is stamped with
 *   MUGGLE_HOOK_HOST=codex instead — through `env`, which every login shell
 *   Codex may run the command in understands.
 * - On Windows Codex runs `commandWindows` through cmd.exe, which cannot run
 *   that POSIX command. Each hook gets a variant that hands the same script to
 *   Git Bash via scripts/codex-hook-windows.cmd, which stamps the host itself.
 * - Codex has its own tool names. A matcher naming a Claude Code tool is
 *   rewritten to the Codex tool that plays its part, and a group whose tools
 *   Codex does not have is dropped.
 *
 * hooks.json stays the one hand-edited manifest. `--check` exits non-zero when
 * the committed file differs from what this script would write.
 */

import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const currentFilePath = fileURLToPath(import.meta.url);
const repositoryRootPath = join(dirname(currentFilePath), "..");
const claudeHooksPath = join(repositoryRootPath, "plugin", "hooks", "hooks.json");
const codexHooksPath = join(repositoryRootPath, "plugin", "hooks", "codex-hooks.json");

/** The stamp that tells the guardrails a hook was fired by Codex, applied portably. */
export const CODEX_HOOK_HOST_STAMP = "env MUGGLE_HOOK_HOST=codex";

/** The cmd.exe launcher a Windows hook runs through; Codex substitutes the plugin root. */
export const CODEX_WINDOWS_HOOK_LAUNCHER = '"${CLAUDE_PLUGIN_ROOT}\\scripts\\codex-hook-windows.cmd"';

// Every hooks.json command runs a shipped bash script; the Windows variant
// hands the rest of the command line to Git Bash.
const BASH_COMMAND_PREFIX = "bash ";

/**
 * Claude Code tool name → the Codex tool that plays its part, or null where
 * Codex has none. Codex reports every shell call as Bash, reads files and skills
 * through the shell, and delivers a background command's output as that
 * command's own Bash event, so Read, Skill and Monitor have no counterpart.
 */
export const CODEX_TOOL_EQUIVALENTS = {
    Bash: "Bash",
    PowerShell: null,
    Read: null,
    Skill: null,
    Monitor: null,
    AskUserQuestion: "request_user_input",
};

const CODEX_HOOKS_DESCRIPTION =
    "Generated from hooks.json by scripts/build-codex-hooks.mjs for the Codex plugin. Edit hooks.json, then run `pnpm run build:codex-hooks`.";

// A matcher made only of names and `|` lists tools (or session-start sources);
// anything else is a regex, which here only ever selects muggle MCP tools whose
// names Codex shares.
const NAME_LIST_MATCHER = /^[A-Za-z0-9_|]+$/;

/**
 * The Codex form of one matcher, or null when it selects nothing Codex has.
 * @param {string | undefined} matcher - The hooks.json matcher.
 * @returns {string | undefined | null} The rewritten matcher; undefined when the group had none.
 */
function deriveCodexMatcher(matcher) {
    if (matcher === undefined || !NAME_LIST_MATCHER.test(matcher)) return matcher;
    const codexNames = [];
    for (const name of matcher.split("|")) {
        const codexName = Object.hasOwn(CODEX_TOOL_EQUIVALENTS, name) ? CODEX_TOOL_EQUIVALENTS[name] : name;
        if (codexName && !codexNames.includes(codexName)) codexNames.push(codexName);
    }
    return codexNames.length > 0 ? codexNames.join("|") : null;
}

/**
 * Derive the Codex hooks manifest from the Claude Code one.
 * @param {{ hooks: Record<string, Array<{ matcher?: string, hooks: Array<Record<string, unknown>> }>> }} claudeHooks - Parsed hooks.json.
 * @returns {{ description: string, hooks: Record<string, Array<{ matcher?: string, hooks: Array<Record<string, unknown>> }>> }} The Codex manifest.
 */
export function deriveCodexHooks(claudeHooks) {
    const codexEvents = {};
    for (const [eventName, groups] of Object.entries(claudeHooks.hooks)) {
        const codexGroups = [];
        for (const group of groups) {
            const codexMatcher = deriveCodexMatcher(group.matcher);
            if (codexMatcher === null) continue;
            const codexGroup = codexMatcher === undefined ? {} : { matcher: codexMatcher };
            codexGroup.hooks = group.hooks.map((hook) => {
                if (!hook.command.startsWith(BASH_COMMAND_PREFIX)) {
                    throw new Error(
                        `hooks.json command does not run a bash script, so it has no Windows form for Codex: ${hook.command}`,
                    );
                }
                return {
                    ...hook,
                    command: `${CODEX_HOOK_HOST_STAMP} ${hook.command}`,
                    commandWindows: `${CODEX_WINDOWS_HOOK_LAUNCHER} ${hook.command.slice(BASH_COMMAND_PREFIX.length)}`,
                };
            });
            codexGroups.push(codexGroup);
        }
        if (codexGroups.length > 0) codexEvents[eventName] = codexGroups;
    }
    return { description: CODEX_HOOKS_DESCRIPTION, hooks: codexEvents };
}

/**
 * The generated file's exact contents for the committed hooks.json.
 * @returns {string} Serialized Codex manifest with a trailing newline.
 */
export function renderCodexHooks() {
    const claudeHooks = JSON.parse(readFileSync(claudeHooksPath, "utf-8"));
    return `${JSON.stringify(deriveCodexHooks(claudeHooks), null, 2)}\n`;
}

/**
 * Write the generated file, or with `--check` verify the committed one matches.
 * @returns {void}
 */
function main() {
    const rendered = renderCodexHooks();
    if (process.argv.includes("--check")) {
        const committed = readFileSync(codexHooksPath, "utf-8");
        if (committed !== rendered) {
            console.error(
                "plugin/hooks/codex-hooks.json is out of date with plugin/hooks/hooks.json. Run `pnpm run build:codex-hooks` and commit the result.",
            );
            process.exit(1);
        }
        console.log("Codex hooks manifest is up to date.");
        return;
    }
    writeFileSync(codexHooksPath, rendered, "utf-8");
    console.log("Codex hooks manifest written to plugin/hooks/codex-hooks.json");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
