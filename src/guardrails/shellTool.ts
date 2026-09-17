import { SHELL_TOOL_NAMES } from "./constants.js";
import type { HookInput } from "./types.js";

/**
 * Whether this tool call ran a shell command.
 *
 * Every guard that reads `tool_input.command` must ask this rather than compare
 * against one tool name: a Windows session runs `gh` through PowerShell, and a
 * guard keyed on Bash alone is not merely quiet there — the deny gates can be
 * walked past by issuing the same command in the other shell.
 */
export function isShellToolCall(input: HookInput): boolean {
  return (SHELL_TOOL_NAMES as readonly string[]).includes(input.tool_name ?? "");
}
