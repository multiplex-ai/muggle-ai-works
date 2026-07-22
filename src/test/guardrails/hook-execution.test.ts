import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, dirname, join } from "path";

// End-to-end hook contract. The per-function guardrail logic is unit-tested
// elsewhere; this file exercises the *entry* the way Claude Code runs it —
// stdin = event JSON, argv[2] = subcommand, stdout = the hook's JSON response —
// by running the real source entry (src/guardrails/cli.ts) as a subprocess.
// It pins stdin parsing, subcommand dispatch, cross-hook state I/O, and stdout
// emission: the observable contract the "Lazy core" footprint refactor must
// preserve when it drops the bash wrappers and collapses the per-event fan-out.
const CLI = fileURLToPath(new URL("../../guardrails/cli.ts", import.meta.url));
const SCRIPTS = fileURLToPath(new URL("../../../plugin/scripts", import.meta.url));
const HOOKS = fileURLToPath(new URL("../../../plugin/hooks/hooks.json", import.meta.url));

describe("guardrail hook execution (cli entry)", () => {
  let home: string;
  beforeEach(() => {
    // sessionState persists under os.homedir(); redirect it to a throwaway dir
    // so a hook run never touches the real ~/.muggle-ai and tests stay isolated.
    home = mkdtempSync(join(tmpdir(), "gr-hook-"));
  });

  function runHook(sub: string, stdin: string): { status: number | null; out: string } {
    const r = spawnSync(process.execPath, ["--import", "tsx", CLI, sub], {
      input: stdin,
      encoding: "utf-8",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    return { status: r.status, out: (r.stdout ?? "").trim() };
  }
  const event = (o: unknown): string => JSON.stringify(o);

  it("pr-opened: emits a PostToolUse watcher nudge for a fresh gh pr create", () => {
    const { status, out } = runHook(
      "pr-opened",
      event({
        session_id: "s1",
        tool_name: "Bash",
        tool_input: { command: "gh pr create --title x --body y" },
        tool_response: { stdout: "https://github.com/multiplex-ai/muggle-ai-ui/pull/342\n" },
      }),
    );
    expect(status).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      "https://github.com/multiplex-ai/muggle-ai-ui/pull/342",
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain("autoWatchPR");
  });

  it("pr-opened: dedupes the same PR within a session (second fire is a no-op)", () => {
    const ev = event({
      session_id: "dedupe",
      tool_name: "Bash",
      tool_input: { command: "gh pr create" },
      tool_response: { stdout: "https://github.com/o/r/pull/9\n" },
    });
    expect(runHook("pr-opened", ev).out).not.toBe("{}");
    // state persisted across separate process invocations under the shared HOME
    expect(runHook("pr-opened", ev).out).toBe("{}");
  });

  it("pr-opened: ignores a non-PR Bash command", () => {
    const { out } = runHook(
      "pr-opened",
      event({
        session_id: "s2",
        tool_name: "Bash",
        tool_input: { command: "git status" },
        tool_response: { stdout: "" },
      }),
    );
    expect(out).toBe("{}");
  });

  it("record-tests -> e2e-gate: a unit-test pass arms the Stop gate (cross-hook state flow)", () => {
    const session = "chain";
    const rec = runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { stdout: "Tests: 18 passed", stderr: "" },
      }),
    );
    expect(rec.out).toBe("{}"); // record-tests only persists, never emits

    const gate = runHook("e2e-gate", event({ session_id: session }));
    const parsed = JSON.parse(gate.out);
    expect(parsed.decision).toBe("block");
    expect(parsed.reason).toContain("E2E");
  });

  it("e2e-gate: stays silent when no unit-test pass was recorded", () => {
    expect(runHook("e2e-gate", event({ session_id: "fresh" })).out).toBe("{}");
  });

  it("record-tests -> e2e-gate: an explicit skip marker releases an armed gate", () => {
    const session = "skip-chain";
    runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { stdout: "Tests: 18 passed", stderr: "" },
      }),
    );
    runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: 'echo "MUGGLE_E2E_SKIP: CLI package, no web surface to drive"' },
        tool_response: { stdout: "MUGGLE_E2E_SKIP: CLI package, no web surface to drive" },
      }),
    );
    expect(runHook("e2e-gate", event({ session_id: session })).out).toBe("{}");
  });

  it("e2e-gate: full instruction on the first block, one-line reminder on repeats", () => {
    const session = "terse-repeats";
    runHook(
      "record-tests",
      event({
        session_id: session,
        tool_name: "Bash",
        tool_input: { command: "pnpm test" },
        tool_response: { stdout: "Tests: 18 passed", stderr: "" },
      }),
    );
    const first = JSON.parse(runHook("e2e-gate", event({ session_id: session })).out);
    expect(first.decision).toBe("block");
    expect(first.reason).toContain("Do not end the turn yet");
    expect(first.reason).toContain("MUGGLE_E2E_SKIP");

    const second = JSON.parse(runHook("e2e-gate", event({ session_id: session })).out);
    expect(second.decision).toBe("block");
    expect(second.reason).toContain("2/3");
    expect(second.reason).toContain("MUGGLE_E2E_SKIP");
    expect(second.reason.length).toBeLessThan(first.reason.length);
  });

  it("build-router: nudges a build ask toward muggle-do, once per session", () => {
    const ev = event({ session_id: "br", prompt: "implement a dark-mode toggle" });
    const first = JSON.parse(runHook("build-router", ev).out);
    expect(first.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(first.hookSpecificOutput.additionalContext).toContain("muggle-do");
    expect(runHook("build-router", ev).out).toBe("{}"); // deduped within the session
  });

  it("build-router: ignores a non-build prompt", () => {
    const { out } = runHook(
      "build-router",
      event({ session_id: "q", prompt: "why does the failed job have no screenshots?" }),
    );
    expect(out).toBe("{}");
  });

  // Never-block guarantee at the entry: a hook must never crash the turn.
  it("degrades to {} on malformed stdin", () => {
    const { status, out } = runHook("pr-opened", "this is not json");
    expect(status).toBe(0);
    expect(out).toBe("{}");
  });

  it("degrades to {} on an unknown subcommand", () => {
    const { status, out } = runHook("does-not-exist", event({ session_id: "s" }));
    expect(status).toBe(0);
    expect(out).toBe("{}");
  });

  it("degrades to {} on empty stdin", () => {
    const { status, out } = runHook("e2e-gate", "");
    expect(status).toBe(0);
    expect(out).toBe("{}");
  });
});

// Lazy-core tripwires. These pin the two things the footprint refactor changes —
// the bash-wrapper "never block" fallback and the per-event fan-out — so either
// change is a conscious, reviewed diff rather than a silent behavior shift. When
// Lazy core lands, update these alongside it (e.g. assert the never-block
// guarantee now lives in guardrails.mjs, and the Bash event drives one observer).
describe("guardrail wrapper never-block fallback (Lazy-core tripwire)", () => {
  it("every wrapper that calls guardrails.mjs falls back to {} and swallows stderr", () => {
    const wrappers = readdirSync(SCRIPTS).filter((f) => f.startsWith("guardrail-") && f.endsWith(".sh"));
    expect(wrappers.length).toBeGreaterThan(0);
    for (const f of wrappers) {
      const body = readFileSync(join(SCRIPTS, f), "utf-8");
      if (!body.includes("guardrails.mjs")) continue;
      expect(body, `${f} must keep its never-block fallback`).toContain("printf '{}'");
      expect(body, `${f} must swallow guardrail stderr`).toContain("2>/dev/null");
    }
  });
});

// The wrappers guard guardrails.mjs behind an in-shell keyword pre-filter so the
// common case (a prompt, a Bash call, a turn end that doesn't concern a guardrail)
// never pays Node cold-start — the fix for hooks stalling the turn on a loaded
// box. These run the real bash wrappers with `node` stubbed on PATH: a marker in
// the output proves Node ran; its absence proves the pre-filter short-circuited.
// Bash-only, so skipped on win32 (covered by the Linux/macOS platform-compat jobs).
describe.skipIf(process.platform === "win32")("guardrail wrapper pre-filter (no Node on the cold path)", () => {
  const NODE_RAN = "__STUB_NODE_RAN__";
  const event = (o: unknown): string => JSON.stringify(o);
  let root: string;
  let binDir: string;

  beforeEach(() => {
    root = dirname(SCRIPTS); // plugin/, so ${root}/scripts/guardrails.mjs resolves
    binDir = mkdtempSync(join(tmpdir(), "gr-stub-"));
    const stub = join(binDir, "node");
    writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s' '${NODE_RAN}'\n`);
    chmodSync(stub, 0o755);
  });

  function runWrapper(script: string, stdin: string): string {
    const home = mkdtempSync(join(tmpdir(), "gr-home-"));
    const r = spawnSync("bash", [join(SCRIPTS, script)], {
      input: stdin,
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_PLUGIN_ROOT: root,
        HOME: home,
        USERPROFILE: home,
      },
    });
    return (r.stdout ?? "").trim();
  }

  it("build-router: skips Node on a non-build prompt, spawns it on a build ask", () => {
    expect(runWrapper("guardrail-build-router.sh", event({ session_id: "a", prompt: "what time is it?" }))).toBe("{}");
    expect(runWrapper("guardrail-build-router.sh", event({ session_id: "b", prompt: "implement dark mode" }))).toContain(NODE_RAN);
  });

  it("pr-opened: skips Node on a plain command, spawns it on gh pr create", () => {
    expect(
      runWrapper("guardrail-pr-opened.sh", event({ tool_name: "Bash", tool_input: { command: "ls -la" } })),
    ).toBe("{}");
    expect(
      runWrapper("guardrail-pr-opened.sh", event({ tool_name: "Bash", tool_input: { command: "gh pr create --fill" } })),
    ).toContain(NODE_RAN);
  });

  it("report-format: skips Node on a plain command, spawns it on gh pr comment", () => {
    expect(
      runWrapper("guardrail-report-format.sh", event({ tool_name: "Bash", tool_input: { command: "git status" } })),
    ).toBe("{}");
    expect(
      runWrapper("guardrail-report-format.sh", event({ tool_name: "Bash", tool_input: { command: "gh pr comment 1 --body x" } })),
    ).toContain(NODE_RAN);
  });

  it("record-tests: skips Node on a plain command, spawns it on a test run", () => {
    expect(
      runWrapper("guardrail-record-tests.sh", event({ tool_name: "Bash", tool_input: { command: "git log" } })),
    ).toBe("{}");
    expect(
      runWrapper("guardrail-record-tests.sh", event({ tool_name: "Bash", tool_input: { command: "pnpm test" } })),
    ).toContain(NODE_RAN);
  });

  it("record-tests: spawns Node on an E2E skip marker", () => {
    expect(
      runWrapper(
        "guardrail-record-tests.sh",
        event({ tool_name: "Bash", tool_input: { command: 'echo "MUGGLE_E2E_SKIP: no app"' } }),
      ),
    ).toContain(NODE_RAN);
  });

  it("e2e-gate: skips Node when no armed state file exists for the session", () => {
    expect(runWrapper("guardrail-e2e-gate.sh", event({ session_id: "no-state" }))).toBe("{}");
  });
});

describe("hooks.json fan-out (Lazy-core tripwire)", () => {
  type HookGroup = { matcher?: string; hooks: Array<{ command: string }> };
  const hooks = (JSON.parse(readFileSync(HOOKS, "utf-8")) as { hooks: Record<string, HookGroup[]> }).hooks;

  it("registers the expected guardrail events", () => {
    expect(Object.keys(hooks).sort()).toEqual(
      ["PostToolUse", "PreToolUse", "SessionStart", "Stop", "UserPromptSubmit"].sort(),
    );
  });

  it("fires exactly two observers on a Bash PostToolUse (pr-opened + record-tests)", () => {
    const bash = hooks.PostToolUse.find((g) => g.matcher === "Bash");
    expect(bash).toBeDefined();
    const cmds = bash!.hooks.map((h) => h.command);
    expect(cmds).toHaveLength(2);
    expect(cmds.some((c) => c.includes("guardrail-pr-opened.sh"))).toBe(true);
    expect(cmds.some((c) => c.includes("guardrail-record-tests.sh"))).toBe(true);
  });
});
