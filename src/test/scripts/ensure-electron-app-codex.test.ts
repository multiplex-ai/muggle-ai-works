import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Shells out to the real hook (bash plus a node child per run), so it takes seconds.
vi.setConfig({ testTimeout: 180_000 });

const toBash = (p: string) => p.replace(/\\/g, "/");

const scriptPath = toBash(
  fileURLToPath(new URL("../../../plugin/scripts/ensure-electron-app.sh", import.meta.url)),
);

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

const PLUGIN_ROOT = "/home/u/.codex/plugins/cache/muggle-works/muggle/5.18.0";

/** A throwaway home with both caches pre-warmed, so the run never reaches `muggle setup` or `npm view`. */
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "muggle-codex-hook-"));
  mkdirSync(join(home, ".cache", "muggle"), { recursive: true });
  writeFileSync(join(home, ".cache", "muggle", "electron-app-checked"), "");
  writeFileSync(join(home, ".cache", "muggle", "version-check"), "1.0.0|1.0.0");
  return home;
}

/** The SessionStart context the hook injects, run with the given host stamp. */
function sessionContext(hookHost: string): string {
  const home = makeHome();
  const stdout = execFileSync("bash", [scriptPath], {
    env: {
      ...process.env,
      HOME: toBash(home),
      USERPROFILE: home,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      CURSOR_PLUGIN_ROOT: "",
      MUGGLE_HOOK_HOST: hookHost,
    },
    encoding: "utf-8",
  });
  const parsed = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
  return parsed.hookSpecificOutput.additionalContext;
}

// Codex sets CLAUDE_PLUGIN_ROOT for hooks but never in the agent's own shell, and
// the skills name Claude Code tools, so a Codex session is told both up front.
describe.skipIf(!hasBash)("ensure-electron-app.sh host notes", () => {
  it("tells a Codex session where the plugin lives and how to read the skills", () => {
    const context = sessionContext("codex");
    expect(context).toContain("running inside Codex");
    expect(context).toContain(`${PLUGIN_ROOT}/skills/_shared/host-tool-equivalents.md`);
    expect(context).toContain(`CLAUDE_PLUGIN_ROOT='${PLUGIN_ROOT}'`);
    expect(context).toContain("$muggle:muggle-test");
  });

  it("adds nothing for Claude Code", () => {
    expect(sessionContext("")).not.toContain("running inside Codex");
  });
});
