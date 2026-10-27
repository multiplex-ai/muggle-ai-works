import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "child_process";
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { HOOK_ENTRY_SCRIPT, deriveBashHookCommand } from "../../../scripts/build-codex-hooks.mjs";
import { allHookCommands, loadHooksManifest, toBashPathArg } from "./footprint/footprint.js";
import { PLUGIN_ROOT } from "./footprint/constants.js";
import { HookShellOstype } from "./footprint/types.js";

// Claude Code runs a hook command through Git Bash on Windows and through /bin/sh elsewhere. hook-entry.sh sources
// the hook's script into Git Bash's own shell, where every process start is expensive, and hands it to a bash of its
// own everywhere else. Each case pins one side of that split with stand-ins for `bash` and `node` first on PATH.
const ENTRY_COMMAND = (script: string, args = ""): string =>
  `set -- ${script}${args ? ` ${args}` : ""}; . "\${CLAUDE_PLUGIN_ROOT}/scripts/${HOOK_ENTRY_SCRIPT}"`;
const STUB_BASH_MARKER = "__STUB_BASH__";
const STUB_NODE_MARKER = "__STUB_NODE__";
const AFTER_ENTRY_MARKER = "__AFTER_ENTRY__";
// More than a pipe buffer holds (64 KiB on Linux), so a payload piped to a Node that never reads it always leaves
// its writer blocked until Node exits, then killed by SIGPIPE.
const PIPE_OVERFLOW_PAYLOAD_BYTES = 256 * 1024;

function createStubBin(): string {
  const binDir = mkdtempSync(join(tmpdir(), "hook-entry-bin-"));
  const stubs: Record<string, string> = {
    bash: `printf '%s %s\\n' '${STUB_BASH_MARKER}' "$*"`,
    node: `shift\nprintf '%s %s' '${STUB_NODE_MARKER}' "$*"`,
  };
  for (const [program, body] of Object.entries(stubs)) {
    writeFileSync(join(binDir, program), `#!/bin/sh\n${body}\n`);
    chmodSync(join(binDir, program), 0o755);
  }
  return binDir;
}

function createProbePluginRoot(): string {
  const pluginRoot = mkdtempSync(join(tmpdir(), "hook-entry-plugin-"));
  mkdirSync(join(pluginRoot, "scripts"));
  copyFileSync(join(PLUGIN_ROOT, "scripts", HOOK_ENTRY_SCRIPT), join(pluginRoot, "scripts", HOOK_ENTRY_SCRIPT));
  writeFileSync(join(pluginRoot, "scripts", "probe.sh"), `probe_ran=1\nprintf 'probe args: %s\\n' "$*"\n`);
  return pluginRoot;
}

function runHookCommand(params: { shell: string; prelude: string; command: string; pluginRoot: string; binDir: string; payload?: string }): string {
  const home = mkdtempSync(join(tmpdir(), "hook-entry-home-"));
  mkdirSync(join(home, ".muggle-ai", "guardrails"), { recursive: true });
  const script = `${params.prelude} PATH="${toBashPathArg(params.binDir)}:$PATH"; ${params.command}; echo "${AFTER_ENTRY_MARKER} \${probe_ran:-}"`;
  const run = spawnSync(params.shell, ["-c", script], {
    input: params.payload ?? "",
    encoding: "utf-8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: params.pluginRoot, HOME: home, USERPROFILE: home },
  });
  return `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
}

describe("hooks.json commands", () => {
  it("every command runs a shipped script through hook-entry.sh", () => {
    for (const hook of allHookCommands(loadHooksManifest())) {
      const bashCommand = deriveBashHookCommand(hook.command);
      const scriptName = /scripts\/([\w.-]+)"/.exec(bashCommand)?.[1];
      expect(scriptName, hook.command).toBeDefined();
      expect(existsSync(join(PLUGIN_ROOT, "scripts", scriptName ?? "")), hook.command).toBe(true);
    }
  });
});

describe("hook-entry.sh", () => {
  let binDir: string;
  let pluginRoot: string;

  beforeEach(() => {
    binDir = createStubBin();
    pluginRoot = createProbePluginRoot();
  });

  it("in Git Bash, runs the script in the shell Claude Code started, starting no bash", () => {
    const output = runHookCommand({ shell: "bash", prelude: `OSTYPE=${HookShellOstype.GitBash};`, command: ENTRY_COMMAND("probe.sh", "a b"), pluginRoot: pluginRoot, binDir: binDir });
    expect(output).toBe(`probe args: a b\n${AFTER_ENTRY_MARKER} 1`);
  });

  it("in Cygwin's bash, runs the script in place too", () => {
    const output = runHookCommand({ shell: "bash", prelude: `OSTYPE=${HookShellOstype.Cygwin};`, command: ENTRY_COMMAND("probe.sh"), pluginRoot: pluginRoot, binDir: binDir });
    expect(output).toBe(`probe args: \n${AFTER_ENTRY_MARKER} 1`);
  });

  it("in any other bash, hands the script and its arguments to a bash of its own", () => {
    const output = runHookCommand({ shell: "bash", prelude: `OSTYPE=${HookShellOstype.Linux};`, command: ENTRY_COMMAND("probe.sh", "a b"), pluginRoot: pluginRoot, binDir: binDir });
    expect(output).toBe(`${STUB_BASH_MARKER} ${pluginRoot}/scripts/probe.sh a b`);
  });

  it("parses as POSIX sh, where a shell that is not bash gets the script a bash of its own", () => {
    const output = runHookCommand({ shell: "sh", prelude: "unset OSTYPE;", command: ENTRY_COMMAND("probe.sh", "a"), pluginRoot: pluginRoot, binDir: binDir });
    expect(output).toBe(`${STUB_BASH_MARKER} ${pluginRoot}/scripts/probe.sh a`);
  });
});

describe("a gate script run through hook-entry.sh", () => {
  let binDir: string;

  beforeEach(() => {
    binDir = createStubBin();
  });

  const buildRequest = JSON.stringify({ session_id: "s", hook_event_name: "UserPromptSubmit", prompt: "please implement the export" });

  it("in Git Bash, takes its standalone path once, exactly as when bash runs it", () => {
    const inPlace = runHookCommand({ shell: "bash", prelude: `OSTYPE=${HookShellOstype.GitBash};`, command: ENTRY_COMMAND("guardrail-build-router.sh"), pluginRoot: PLUGIN_ROOT, binDir: binDir, payload: buildRequest });
    expect(inPlace).toBe(`${STUB_NODE_MARKER} build-router${AFTER_ENTRY_MARKER}`);
  });

  it("prints Node's answer alone when Node exits without reading its stdin", () => {
    const oversizedBuildRequest = JSON.stringify({ session_id: "s", prompt: "please implement the export", padding: "x".repeat(PIPE_OVERFLOW_PAYLOAD_BYTES) });
    const inPlace = runHookCommand({ shell: "bash", prelude: `OSTYPE=${HookShellOstype.GitBash};`, command: ENTRY_COMMAND("guardrail-build-router.sh"), pluginRoot: PLUGIN_ROOT, binDir: binDir, payload: oversizedBuildRequest });
    expect(inPlace).toBe(`${STUB_NODE_MARKER} build-router${AFTER_ENTRY_MARKER}`);
  });

  it("in Git Bash, answers an irrelevant prompt in-shell with {}", () => {
    const question = JSON.stringify({ session_id: "s", hook_event_name: "UserPromptSubmit", prompt: "what is the status?" });
    const inPlace = runHookCommand({ shell: "bash", prelude: `OSTYPE=${HookShellOstype.GitBash};`, command: ENTRY_COMMAND("guardrail-build-router.sh"), pluginRoot: PLUGIN_ROOT, binDir: binDir, payload: question });
    expect(inPlace).toBe(`{}${AFTER_ENTRY_MARKER}`);
  });
});
