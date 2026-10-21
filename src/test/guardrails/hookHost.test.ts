import { describe, it, expect } from "vitest";
import { resolveHookHost, skillInvocation } from "../../guardrails/hookHost.js";
import { HOOK_HOST_ENV_VAR } from "../../guardrails/constants.js";

describe("resolveHookHost", () => {
  // Codex exports CLAUDE_PLUGIN_ROOT to plugin hooks, so only its manifest's
  // stamp separates it from Claude Code.
  it("is codex only when the Codex manifest stamped the command", () => {
    expect(resolveHookHost({ [HOOK_HOST_ENV_VAR]: "codex", CLAUDE_PLUGIN_ROOT: "/p" })).toBe("codex");
    expect(resolveHookHost({ CLAUDE_PLUGIN_ROOT: "/p", PLUGIN_ROOT: "/p" })).toBe("claude");
  });

  it("recognises Cursor by the plugin root it exports", () => {
    expect(resolveHookHost({ CURSOR_PLUGIN_ROOT: "/p" })).toBe("cursor");
  });

  it("defaults to Claude Code, and ignores a stamp naming no host it knows", () => {
    expect(resolveHookHost({})).toBe("claude");
    expect(resolveHookHost({ [HOOK_HOST_ENV_VAR]: "vim" })).toBe("claude");
  });
});

describe("skillInvocation", () => {
  it("keeps the slash command as written for Claude Code and Cursor", () => {
    expect(skillInvocation("/muggle:muggle-test", "claude")).toBe("/muggle:muggle-test");
    expect(skillInvocation("/muggle-do", "cursor")).toBe("/muggle-do");
  });

  it("spells it as a namespaced $ mention for Codex", () => {
    expect(skillInvocation("/muggle:muggle-test", "codex")).toBe("$muggle:muggle-test");
    expect(skillInvocation("/muggle-do", "codex")).toBe("$muggle:muggle-do");
  });
});
