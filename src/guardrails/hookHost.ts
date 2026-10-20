import { HOOK_HOST_ENV_VAR } from "./constants.js";
import type { Host } from "./emit.js";

/**
 * The agent host that fired this hook.
 *
 * Codex is recognised only by the stamp its hooks manifest writes onto every
 * command: it exports CLAUDE_PLUGIN_ROOT to plugin hooks for compatibility, so
 * any inference from the environment would read it as Claude Code. Cursor is
 * recognised by the plugin root it exports.
 */
export function resolveHookHost(env: NodeJS.ProcessEnv = process.env): Host {
  if (env[HOOK_HOST_ENV_VAR] === "codex") return "codex";
  if (env.CURSOR_PLUGIN_ROOT) return "cursor";
  return "claude";
}

/**
 * A Muggle skill invocation spelled the way this host takes it.
 *
 * Claude Code and Cursor run the slash command as given. Codex has no slash
 * commands for plugin skills — it invokes them by `$` mention of the plugin's
 * namespaced skill name.
 *
 * Output shape: `skillInvocation("/muggle-do", "codex")` → `"$muggle:muggle-do"`
 */
export function skillInvocation(slashCommand: string, host: Host): string {
  if (host !== "codex") return slashCommand;
  return `$muggle:${slashCommand.replace(/^\/(?:muggle:)?/, "")}`;
}
