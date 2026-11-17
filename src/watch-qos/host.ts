import type { Host } from "../guardrails/emit.js";
import { WatchQosHost } from "./types.js";

/** The telemetry host for a hook host: Codex as itself, Claude Code and Cursor (which runs Claude Code's plugin hooks) as Claude Code. */
export function watchQosHostOfHookHost(host: Host): WatchQosHost {
  return host === "codex" ? WatchQosHost.Codex : WatchQosHost.ClaudeCode;
}
