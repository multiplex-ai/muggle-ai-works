import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, dirname, join } from "path";
import { fileURLToPath } from "url";
import { mergeHookOutputs } from "../../guardrails/emit.js";

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
// the output shows whether Node ran at all and which gates the pre-filters let through.
// Bash-only, so skipped on win32 (covered by the Linux/macOS platform-compat jobs).
describe.skipIf(process.platform === "win32")("guardrail-dispatch.sh", () => {
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
    if (!group || group.hooks.length !== 1) throw new Error(`${event}[${matcher}] is not a single dispatcher command`);
    return group.hooks[0].command;
  };

  function fire(command: string, payload: unknown, seededState?: { sessionId: string } & Record<string, unknown>): string {
    const home = mkdtempSync(join(tmpdir(), "gr-dispatch-home-"));
    mkdirSync(join(home, ".muggle-ai", "guardrails"), { recursive: true });
    if (seededState) {
      writeFileSync(
        join(home, ".muggle-ai", "guardrails", `${seededState.sessionId}.json`),
        JSON.stringify(seededState, null, 2),
      );
    }
    const r = spawnSync("bash", ["-c", command], {
      input: JSON.stringify(payload),
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_PLUGIN_ROOT: dirname(SCRIPTS),
        HOME: home,
        USERPROFILE: home,
      },
    });
    return (r.stdout ?? "").trim();
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

  it("answers a turn end with no guardrail state in-shell", () => {
    expect(fire(hookCommand("Stop"), { session_id: "idle" })).toBe("{}");
  });

  it("starts Node once for exactly the Stop gates the session state arms", () => {
    const openedPr = { sessionId: "pr", prsHandled: ["https://github.com/o/r/pull/1"] };
    expect(fire(hookCommand("Stop"), { session_id: "pr" }, openedPr)).toBe(`${NODE_RAN} run e2e-gate watch-gate`);
  });
});
