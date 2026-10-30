import { describe, it, expect, beforeEach } from "vitest";
import { spawn, spawnSync } from "child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, dirname, join } from "path";
import { fileURLToPath } from "url";
import { mergeHookOutputs } from "../../guardrails/emit.js";
import { HookShellOstype } from "./footprint/types.js";

const SCRIPTS = fileURLToPath(new URL("../../../plugin/scripts", import.meta.url));
const HOOKS = fileURLToPath(new URL("../../../plugin/hooks/hooks.json", import.meta.url));

describe("mergeHookOutputs", () => {
  const context = (eventName: string, text: string): string =>
    JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } });

  it("returns {} when no gate had anything to say", () => {
    expect(mergeHookOutputs(["{}", "{}"], "claude")).toBe("{}");
  });

  it("joins every Stop block reason into one block", () => {
    const merged = JSON.parse(
      mergeHookOutputs(
        [JSON.stringify({ decision: "block", reason: "run E2E" }), "{}", JSON.stringify({ decision: "block", reason: "arm the watcher" })],
        "claude",
      ),
    );
    expect(merged).toEqual({ decision: "block", reason: "run E2E\n\narm the watcher" });
  });

  it("lets a PreToolUse deny win over context", () => {
    const deny = JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "bad heading" },
    });
    const merged = JSON.parse(mergeHookOutputs([context("PreToolUse", "fyi"), deny], "claude"));
    expect(merged.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(merged.hookSpecificOutput.permissionDecisionReason).toBe("bad heading");
  });

  it("concatenates context under the gates' own event name", () => {
    const merged = JSON.parse(mergeHookOutputs([context("PostToolUse", "PR opened"), context("PostToolUse", "tests green")], "claude"));
    expect(merged.hookSpecificOutput).toEqual({ hookEventName: "PostToolUse", additionalContext: "PR opened\n\ntests green" });
  });

  it("merges cursor advisories and ignores output that is not JSON", () => {
    const merged = JSON.parse(
      mergeHookOutputs([JSON.stringify({ additional_context: "a" }), "not json", JSON.stringify({ additional_context: "b" })], "cursor"),
    );
    expect(merged).toEqual({ additional_context: "a\n\nb" });
  });
});

// Runs the real dispatcher commands from hooks.json with `node` stubbed to echo its argv, so
// the output shows whether Node ran at all and which gates the pre-filters let through — both
// in a bash of its own and sourced into Git Bash's shell, where hook-entry.sh runs it on Windows.
// Bash-only, so skipped on win32 (covered by the Linux/macOS platform-compat jobs).
describe.skipIf(process.platform === "win32").each([
  ["in a bash of its own", HookShellOstype.Linux],
  ["sourced into Git Bash's shell", HookShellOstype.GitBash],
])("guardrail-dispatch.sh %s", (_label, shellOstype) => {
  const NODE_RAN = "__STUB_NODE_RAN__";
  let binDir: string;

  beforeEach(() => {
    binDir = mkdtempSync(join(tmpdir(), "gr-dispatch-stub-"));
    const stub = join(binDir, "node");
    writeFileSync(stub, `#!/usr/bin/env bash\nshift\nprintf '%s %s' '${NODE_RAN}' "$*"\n`);
    chmodSync(stub, 0o755);
  });

  const hookCommand = (event: string, matcher?: string): string => {
    const hooks = (JSON.parse(readFileSync(HOOKS, "utf-8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    }).hooks;
    const group = hooks[event].find((candidate) => candidate.matcher === matcher);
    // A group's `if` variants all launch the one dispatcher command, each for the calls its rule names.
    const distinctCommands = new Set(group?.hooks.map((hook) => hook.command));
    if (!group || distinctCommands.size !== 1) throw new Error(`${event}[${matcher}] is not a single dispatcher command`);
    return group.hooks[0].command;
  };

  const createHome = (): string => {
    const home = mkdtempSync(join(tmpdir(), "gr-dispatch-home-"));
    mkdirSync(join(home, ".muggle-ai", "guardrails"), { recursive: true });
    return home;
  };

  const dispatchEnvironment = (home: string): NodeJS.ProcessEnv => ({
    ...process.env,
    PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
    CLAUDE_PLUGIN_ROOT: dirname(SCRIPTS),
    HOME: home,
    USERPROFILE: home,
  });

  function fire(
    command: string,
    payload: unknown,
    seededState?: { sessionId: string } & Record<string, unknown>,
    home: string = createHome(),
  ): string {
    if (seededState) {
      writeFileSync(
        join(home, ".muggle-ai", "guardrails", `${seededState.sessionId}.json`),
        JSON.stringify(seededState, null, 2),
      );
    }
    const r = spawnSync("bash", ["-c", `OSTYPE='${shellOstype}'; ${command}`], {
      input: JSON.stringify(payload),
      encoding: "utf-8",
      env: dispatchEnvironment(home),
    });
    return (r.stdout ?? "").trim();
  }

  function fireConcurrently(command: string, payload: unknown, launchCount: number, home: string): Promise<string[]> {
    return Promise.all(
      Array.from(
        { length: launchCount },
        () =>
          new Promise<string>((resolve) => {
            const launch = spawn("bash", ["-c", `OSTYPE='${shellOstype}'; ${command}`], { env: dispatchEnvironment(home) });
            let stdout = "";
            launch.stdout.on("data", (chunk: Buffer) => {
              stdout += chunk.toString();
            });
            launch.on("close", () => resolve(stdout.trim()));
            launch.stdin.end(JSON.stringify(payload));
          }),
      ),
    );
  }

  it("answers an irrelevant Bash call in-shell, without Node", () => {
    const payload = { session_id: "s", tool_name: "Bash", tool_input: { command: "ls -la" } };
    expect(fire(hookCommand("PreToolUse", "Bash|PowerShell"), payload)).toBe("{}");
    expect(fire(hookCommand("PostToolUse", "Bash|PowerShell"), payload)).toBe("{}");
  });

  it("starts Node once for every PostToolUse gate a gh pr create concerns", () => {
    const payload = { session_id: "s", tool_name: "Bash", tool_input: { command: "gh pr create --fill" } };
    expect(fire(hookCommand("PostToolUse", "Bash|PowerShell"), payload)).toBe(`${NODE_RAN} run pr-opened record-tests`);
  });

  // Claude Code launches the dispatcher once per `if` variant whose rule matches, so one call can arrive several times.
  describe("one tool call launched by several if variants", () => {
    const prCreatePayload = {
      session_id: "s",
      hook_event_name: "PostToolUse",
      tool_use_id: "toolu_01PrCreate",
      tool_name: "PowerShell",
      tool_input: { command: "gh pr create --body-file notes.md" },
    };

    it("starts Node for the first launch only", () => {
      const home = createHome();
      const dispatcher = hookCommand("PostToolUse", "Bash|PowerShell");
      expect(fire(dispatcher, prCreatePayload, undefined, home)).toBe(`${NODE_RAN} run pr-opened record-tests`);
      expect(fire(dispatcher, prCreatePayload, undefined, home)).toBe("{}");
    });

    it("starts Node exactly once when the launches race", async () => {
      const home = createHome();
      const answers = await fireConcurrently(hookCommand("PostToolUse", "Bash|PowerShell"), prCreatePayload, 6, home);
      expect(answers.filter((answer) => answer.startsWith(NODE_RAN))).toHaveLength(1);
      expect(answers.filter((answer) => answer === "{}")).toHaveLength(5);
    });

    it("claims each event separately, so a call's PreToolUse launch never silences its PostToolUse one", () => {
      const home = createHome();
      const commentCall = { ...prCreatePayload, tool_input: { command: "gh pr comment 1 --body 'results'" } };
      expect(fire(hookCommand("PreToolUse", "Bash|PowerShell"), { ...commentCall, hook_event_name: "PreToolUse" }, undefined, home)).toContain(NODE_RAN);
      expect(fire(hookCommand("PostToolUse", "Bash|PowerShell"), commentCall, undefined, home)).toContain(NODE_RAN);
    });

    it("runs every launch of a payload that names no tool call", () => {
      const home = createHome();
      const unnamedCall = { ...prCreatePayload, tool_use_id: undefined };
      const dispatcher = hookCommand("PostToolUse", "Bash|PowerShell");
      expect(fire(dispatcher, unnamedCall, undefined, home)).toContain(NODE_RAN);
      expect(fire(dispatcher, unnamedCall, undefined, home)).toContain(NODE_RAN);
    });

    it("creates the claims directory on the first claim", () => {
      const home = mkdtempSync(join(tmpdir(), "gr-dispatch-home-"));
      expect(fire(hookCommand("PostToolUse", "Bash|PowerShell"), prCreatePayload, undefined, home)).toContain(NODE_RAN);
      expect(existsSync(join(home, ".muggle-ai", "guardrails", "claims", "PostToolUse-toolu_01PrCreate"))).toBe(true);
    });
  });

  it("answers a turn end with no guardrail state in-shell", () => {
    expect(fire(hookCommand("Stop"), { session_id: "idle" })).toBe("{}");
  });

  it("starts Node once for exactly the Stop gates the session state arms", () => {
    const openedPr = { sessionId: "pr", prsHandled: ["https://github.com/o/r/pull/1"] };
    expect(fire(hookCommand("Stop"), { session_id: "pr" }, openedPr)).toBe(`${NODE_RAN} run e2e-gate watch-gate`);
  });

  it("answers an owed E2E run's turn end with its rendered block, without Node", () => {
    const home = createHome();
    const renderedBlock = JSON.stringify({ decision: "block", reason: "run /muggle:muggle-test" });
    writeFileSync(join(home, ".muggle-ai", "guardrails", "rendered.e2e-stop-verdict"), `3\n${renderedBlock}`);
    const openedPr = { sessionId: "rendered", prsHandled: ["https://github.com/o/r/pull/1"] };
    expect(fire(hookCommand("Stop"), { session_id: "rendered" }, openedPr, home)).toBe(renderedBlock);
  });
});
