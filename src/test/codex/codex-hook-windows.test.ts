import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { gitBashCandidates } from "../../../plugin/scripts/codex-hook-windows.mjs";

// Codex runs a hook's commandWindows through the session shell — PowerShell by
// default, cmd.exe as a fallback (codex-rs/core/src/shell.rs derive_exec_args,
// codex-rs/hooks/src/engine/command_runner.rs). The generated command starts
// with a bare `node` so both shells parse it; a quoted launcher path there was
// a PowerShell syntax error, which Codex records as a failed hook and ignores —
// every guardrail silently off on Windows.
const PLUGIN_ROOT = fileURLToPath(new URL("../../../plugin", import.meta.url));
const LAUNCHER = join(PLUGIN_ROOT, "scripts", "codex-hook-windows.mjs");
const CODEX_HOOKS = join(PLUGIN_ROOT, "hooks", "codex-hooks.json");

type HooksManifest = { hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ commandWindows: string }> }>> };

function hookScript(body: string): string {
  const script = join(mkdtempSync(join(tmpdir(), "codex-hook-win-")), "hook.sh");
  writeFileSync(script, body);
  return script;
}

function runLauncher(script: string, args: string[], input: string, env: NodeJS.ProcessEnv) {
  return spawnSync(process.execPath, [LAUNCHER, script, ...args], { input: input, encoding: "utf-8", env: env });
}

describe("gitBashCandidates", () => {
  it("tries an explicit MUGGLE_HOOK_BASH first", () => {
    expect(gitBashCandidates({ MUGGLE_HOOK_BASH: "D:\\tools\\bash.exe" }, [])[0]).toBe("D:\\tools\\bash.exe");
  });

  it("looks beside every git.exe on PATH, then the machine-wide and per-user installs", () => {
    expect(
      gitBashCandidates(
        {
          ProgramFiles: "C:\\Program Files",
          "ProgramFiles(x86)": "C:\\Program Files (x86)",
          LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local",
        },
        ["C:\\Program Files\\Git\\cmd\\git.exe"],
      ),
    ).toEqual([
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
      "C:\\Users\\u\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
    ]);
  });
});

describe("codex-hook-windows.mjs", () => {
  // Off Windows, `where git` is never consulted, so the override names the bash
  // under test; on a Windows runner the launcher finds Git Bash the way it would
  // on a user's machine.
  const bashEnv = (): NodeJS.ProcessEnv =>
    process.platform === "win32" ? { ...process.env } : { ...process.env, MUGGLE_HOOK_BASH: "/bin/bash" };

  it("runs the script under bash with the hook's stdin, the host stamp and its exit code", () => {
    const script = hookScript('printf \'%s|%s|%s\' "$MUGGLE_HOOK_HOST" "$1" "$(cat)"\nexit 7\n');
    const run = runLauncher(script, ["first-arg"], '{"session_id":"s"}', bashEnv());
    expect(run.stdout).toBe('codex|first-arg|{"session_id":"s"}');
    expect(run.status).toBe(7);
  });

  it.skipIf(process.platform === "win32")("answers {} and succeeds when no bash can be found", () => {
    const script = hookScript("exit 3\n");
    const run = runLauncher(script, [], "{}", { PATH: process.env.PATH, MUGGLE_HOOK_BASH: join(tmpdir(), "no-such-bash.exe") });
    expect(run.stdout.trim()).toBe("{}");
    expect(run.status).toBe(0);
  });
});

// The real thing, on the Windows CI runner: each shell Codex can pick runs a
// generated commandWindows against a real guardrail script with Codex's
// payload on stdin. A non-build prompt is the build router's no-op, so a clean
// `{}` proves the command parsed, the launcher found Git Bash, and the payload
// arrived.
describe.skipIf(process.platform !== "win32")("generated commandWindows under the shells Codex uses", () => {
  const manifest = JSON.parse(readFileSync(CODEX_HOOKS, "utf-8")) as HooksManifest;
  const routerCommand = manifest.hooks.UserPromptSubmit[0].hooks[0].commandWindows.replaceAll(
    "${CLAUDE_PLUGIN_ROOT}",
    PLUGIN_ROOT,
  );
  const payload = JSON.stringify({ session_id: "codex-win", hook_event_name: "UserPromptSubmit", prompt: "what time is it?" });

  it("finds Git Bash on the runner", () => {
    expect(gitBashCandidates(process.env, []).some((candidate) => existsSync(candidate))).toBe(true);
  });

  it("runs under PowerShell, Codex's default hook shell", () => {
    const run = spawnSync("powershell.exe", ["-NoProfile", "-Command", routerCommand], { input: payload, encoding: "utf-8" });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe("{}");
  });

  it("runs under cmd.exe, Codex's fallback, quoted the way Codex quotes it", () => {
    const run = spawnSync("cmd.exe", ["/C", `"${routerCommand}"`], {
      input: payload,
      encoding: "utf-8",
      windowsVerbatimArguments: true,
    });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe("{}");
  });
});
