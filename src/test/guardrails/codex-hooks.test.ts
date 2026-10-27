import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import {
  CODEX_HOOK_HOST_STAMP,
  CODEX_LAUNCHER_ALLOWANCE_SECONDS,
  CODEX_TOOL_EQUIVALENTS,
  CODEX_WINDOWS_HOOK_LAUNCHER,
  HOOK_ENTRY_SCRIPT,
  deriveBashHookCommand,
  deriveCodexHooks,
  renderCodexHooks,
} from "../../../scripts/build-codex-hooks.mjs";
import { SHELL_RECORDER_SCRIPTS } from "./support/constants.js";

// plugin/hooks/codex-hooks.json is what the Codex plugin manifest points Codex
// at, generated from hooks.json. Codex runs Claude Code-format hooks, so the
// guarantees here are the differences: the host stamp, the Windows variant, and
// tool names Codex actually reports.
const CLAUDE_HOOKS = fileURLToPath(new URL("../../../plugin/hooks/hooks.json", import.meta.url));
const CODEX_HOOKS = fileURLToPath(new URL("../../../plugin/hooks/codex-hooks.json", import.meta.url));
const GENERATOR = fileURLToPath(new URL("../../../scripts/build-codex-hooks.mjs", import.meta.url));
const CODEX_PLUGIN_MANIFEST = fileURLToPath(new URL("../../../plugin/.codex-plugin/plugin.json", import.meta.url));

type HookCommand = { command: string; commandWindows?: string; timeout?: number };
type HookGroup = { matcher?: string; hooks: HookCommand[] };
type HooksManifest = { hooks: Record<string, HookGroup[]> };

const readManifest = (path: string): HooksManifest => JSON.parse(readFileSync(path, "utf-8")) as HooksManifest;
const allCommands = (manifest: HooksManifest): HookCommand[] =>
  Object.values(manifest.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));

describe("plugin/hooks/codex-hooks.json", () => {
  const codex = readManifest(CODEX_HOOKS);

  it("is exactly what the generator derives from hooks.json", () => {
    expect(readFileSync(CODEX_HOOKS, "utf-8")).toBe(renderCodexHooks());
    expect(spawnSync(process.execPath, [GENERATOR, "--check"], { encoding: "utf-8" }).status).toBe(0);
  });

  it("is the hooks manifest the Codex plugin manifest declares", () => {
    const manifest = JSON.parse(readFileSync(CODEX_PLUGIN_MANIFEST, "utf-8")) as { hooks?: string };
    expect(manifest.hooks).toBe("./hooks/codex-hooks.json");
  });

  // Codex exports CLAUDE_PLUGIN_ROOT to hooks, so the stamp is the only way a
  // guardrail knows to word itself for Codex and accept a Codex-shaped offer.
  it("stamps every command with the Codex host", () => {
    for (const hook of allCommands(codex)) {
      expect(hook.command.startsWith(`${CODEX_HOOK_HOST_STAMP} bash `), hook.command).toBe(true);
    }
  });

  // Codex runs commandWindows through cmd.exe, which cannot run the POSIX form.
  it("gives every command a Windows form that runs the same script through the Git Bash launcher", () => {
    for (const hook of allCommands(codex)) {
      expect(hook.commandWindows?.startsWith(`${CODEX_WINDOWS_HOOK_LAUNCHER} `), hook.command).toBe(true);
      expect(hook.commandWindows?.slice(CODEX_WINDOWS_HOOK_LAUNCHER.length)).toBe(
        hook.command.slice(`${CODEX_HOOK_HOST_STAMP} bash`.length),
      );
    }
  });

  // hooks.json holds each hook's runtime budget; Codex's timeout also covers the shell it launches the hook through.
  it("gives every hook its hooks.json timeout plus the launcher allowance", () => {
    const claudeTimeouts = new Map(
      allCommands(readManifest(CLAUDE_HOOKS)).map((hook) => [deriveBashHookCommand(hook.command), hook.timeout]),
    );
    for (const hook of allCommands(codex)) {
      const claudeTimeout = claudeTimeouts.get(hook.command.slice(`${CODEX_HOOK_HOST_STAMP} `.length));
      expect(claudeTimeout, hook.command).toBeTypeOf("number");
      expect(hook.timeout, hook.command).toBe((claudeTimeout ?? 0) + CODEX_LAUNCHER_ALLOWANCE_SECONDS);
    }
  });

  // Codex has no `if` rule; what it would make of one is unspecified, so none reaches it.
  it("carries no if rule", () => {
    for (const hook of allCommands(codex)) expect(hook, hook.command).not.toHaveProperty("if");
  });

  it("names no Claude Code tool Codex does not have", () => {
    const missingInCodex = Object.entries(CODEX_TOOL_EQUIVALENTS)
      .filter(([, codexName]) => codexName === null)
      .map(([claudeName]) => claudeName);
    for (const groups of Object.values(codex.hooks)) {
      for (const group of groups) {
        for (const name of group.matcher?.split("|") ?? []) {
          expect(missingInCodex, group.matcher).not.toContain(name);
        }
      }
    }
  });

  it("keeps every shipped script reachable, the Read- and Skill-only recorders through Bash and MCP", () => {
    const scriptsIn = (manifest: HooksManifest): Set<string> =>
      new Set(
        allCommands(manifest)
          .flatMap((hook) => hook.command.match(/[\w-]+\.sh/g) ?? [])
          .filter((script) => script !== HOOK_ENTRY_SCRIPT),
      );
    const claudeScripts = scriptsIn(readManifest(CLAUDE_HOOKS));
    const codexScripts = scriptsIn(codex);
    for (const script of claudeScripts) expect(codexScripts, script).toContain(script);
  });

  // With no `if` to narrow it, Codex must run the recorders' one dispatcher on every shell call, never once per variant.
  it("runs one dispatcher feeding every shell recorder after each Bash call", () => {
    const shellGroups = codex.hooks.PostToolUse.filter((group) => group.matcher === "Bash");
    expect(shellGroups).toHaveLength(1);
    expect(shellGroups[0].hooks).toHaveLength(1);
    const dispatcherCommand = shellGroups[0].hooks[0].command;
    for (const recorder of SHELL_RECORDER_SCRIPTS) expect(dispatcherCommand, recorder).toContain(recorder);
  });

  it("offers the post-merge handoff through Codex's own question tool", () => {
    const offerGroup = codex.hooks.PostToolUse.find((group) =>
      group.hooks.some((hook) => hook.command.includes("guardrail-offer-ran.sh")),
    );
    expect(offerGroup?.matcher).toBe("request_user_input");
  });
});

describe("deriveCodexHooks", () => {
  const command = (script: string): { type: string; command: string } => ({
    type: "command",
    command: `set -- ${script}; . "\${CLAUDE_PLUGIN_ROOT}/scripts/${HOOK_ENTRY_SCRIPT}"`,
  });

  it("names the hook's script and arguments directly, since Codex starts every command as a process anyway", () => {
    const derived = deriveCodexHooks({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: `set -- gate.sh a.sh b.sh; . "\${CLAUDE_PLUGIN_ROOT}/scripts/${HOOK_ENTRY_SCRIPT}"` }] }],
      },
    });
    const codexHook = derived.hooks.Stop[0].hooks[0];
    expect(codexHook.command).toBe(`${CODEX_HOOK_HOST_STAMP} bash "\${CLAUDE_PLUGIN_ROOT}/scripts/gate.sh" a.sh b.sh`);
    expect(codexHook.commandWindows).toBe(`${CODEX_WINDOWS_HOOK_LAUNCHER} "\${CLAUDE_PLUGIN_ROOT}/scripts/gate.sh" a.sh b.sh`);
  });

  it("rewrites tool names, drops groups Codex cannot match, and leaves MCP regexes and sources alone", () => {
    const derived = deriveCodexHooks({
      hooks: {
        SessionStart: [{ matcher: "startup|clear", hooks: [command("a.sh")] }],
        PostToolUse: [
          { matcher: "Bash|PowerShell", hooks: [command("b.sh")] },
          { matcher: "Read", hooks: [command("c.sh")] },
          { matcher: "mcp__.*muggle.*replay", hooks: [command("d.sh")] },
          { matcher: "AskUserQuestion", hooks: [command("e.sh")] },
        ],
        Stop: [{ hooks: [command("f.sh")] }],
      },
    });
    expect(derived.hooks.SessionStart[0].matcher).toBe("startup|clear");
    expect(derived.hooks.PostToolUse.map((group) => group.matcher)).toEqual([
      "Bash",
      "mcp__.*muggle.*replay",
      "request_user_input",
    ]);
    expect(derived.hooks.Stop[0]).not.toHaveProperty("matcher");
  });

  it("drops an event whose every group selects only tools Codex lacks", () => {
    const derived = deriveCodexHooks({ hooks: { PostToolUse: [{ matcher: "Skill|Monitor", hooks: [command("x.sh")] }] } });
    expect(derived.hooks).not.toHaveProperty("PostToolUse");
  });

  it("drops each if rule and runs the command its variants shared once", () => {
    const derived = deriveCodexHooks({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash|PowerShell",
            hooks: [
              { ...command("gate.sh"), if: "Bash(*gh *)" },
              { ...command("gate.sh"), if: "PowerShell(*gh *)" },
              { ...command("other-gate.sh"), if: "Bash(*glab *)" },
            ],
          },
        ],
      },
    });
    const codexHooks = derived.hooks.PreToolUse[0].hooks;
    expect(codexHooks.map((hook) => hook.command)).toEqual([
      `${CODEX_HOOK_HOST_STAMP} ${deriveBashHookCommand(command("gate.sh").command)}`,
      `${CODEX_HOOK_HOST_STAMP} ${deriveBashHookCommand(command("other-gate.sh").command)}`,
    ]);
    for (const hook of codexHooks) expect(hook).not.toHaveProperty("if");
  });

  it("refuses a command that skips hook-entry.sh, which would have no bash form for Codex", () => {
    for (const command of ["node x.mjs", `bash "\${CLAUDE_PLUGIN_ROOT}/scripts/x.sh"`]) {
      expect(() => deriveCodexHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: command }] }] } }), command).toThrow(
        /does not run a script through hook-entry\.sh/,
      );
    }
  });
});
