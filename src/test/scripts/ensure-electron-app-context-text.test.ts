import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildPreferencesContext } from "../../../internal/agent-gate-eval/src/session-context.js";

// Shells out to the real hook (bash plus a node child per run), so it takes seconds.
vi.setConfig({ testTimeout: 180_000 });

const toBash = (p: string) => p.replace(/\\/g, "/");

const pluginDir = fileURLToPath(new URL("../../../plugin", import.meta.url));
const scriptPath = toBash(join(pluginDir, "scripts", "ensure-electron-app.sh"));

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

const PLUGIN_ROOT = "/home/u/.codex/plugins/cache/muggle-works/muggle/5.18.0";

function writeJson(file: string, contents: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(contents));
}

/**
 * The context a session starts with when every optional block is due: the
 * upgrade notice, the first-run offer, the retired project preferences notice,
 * and both last-used lines.
 */
function contextWithEveryBlock(hookHost: string): string {
  const home = mkdtempSync(join(tmpdir(), "muggle-context-home-"));
  const cache = join(home, ".cache", "muggle");
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, "electron-app-checked"), "");
  // The version cache agrees with the notice, and the upkeep is not due, so the
  // detached upkeep can neither run setup nor retract the notice mid-run.
  writeFileSync(join(cache, "version-check"), "1.0.0|2.0.0");
  writeFileSync(join(cache, "upgrade-available"), "1.0.0|2.0.0");
  writeFileSync(join(cache, "session-maintenance-due"), "99999999999");

  const cwd = mkdtempSync(join(tmpdir(), "muggle-context-cwd-"));
  writeJson(join(cwd, ".muggle-ai", "preferences.json"), { preferences: { autoE2ETest: "never" } });
  writeJson(join(cwd, ".muggle-ai", "last-project.json"), {
    lastProject: { projectId: "proj-1", projectUrl: "https://app.example.com", projectName: "Shop" },
  });
  writeJson(join(cwd, ".muggle-ai", "last-host.json"), { lastHost: { host: "http://localhost:3000" } });

  const stdout = execFileSync("bash", [scriptPath], {
    cwd: cwd,
    env: {
      ...process.env,
      HOME: toBash(home),
      USERPROFILE: home,
      CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
      CURSOR_PLUGIN_ROOT: "",
      CLAUDE_CWD: "",
      CURSOR_CWD: "",
      MUGGLE_HOOK_HOST: hookHost,
    },
    encoding: "utf-8",
  });
  return (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput
    .additionalContext;
}

describe.skipIf(!hasBash)("ensure-electron-app.sh context text", () => {
  it.each([
    ["Claude Code", ""],
    ["Codex", "codex"],
  ])("breaks every block onto lines of its own under %s", (_host, hookHost) => {
    const context = contextWithEveryBlock(hookHost);
    const lines = context.split("\n");

    expect(lines[0]).toBe("<EXTREMELY_IMPORTANT>");
    expect(lines).toContain("- Testing user flows (signup, login, checkout, forms, dashboards)");
    expect(lines).toContain("</EXTREMELY_IMPORTANT>");
    expect(lines).toContain(
      "A newer @muggleai/works is available (1.0.0 → 2.0.0). Tell the user to run `/muggle:muggle-upgrade` to update.",
    );
    expect(lines.some((line) => line.startsWith("Muggle Test first-run setup has not been run"))).toBe(true);
    expect(lines).toContain(
      "Tell the user to re-apply any they want everywhere with `/muggle-preferences`; the file is safe to delete.",
    );
    expect(lines).toContain('Muggle Test Last Project: id=proj-1 url=https://app.example.com name="Shop"');
    expect(lines).toContain("Muggle Test Last Host: http://localhost:3000");
    // The agent-gate eval synthesizes this block for its skill sessions, so it must be what a session really gets.
    expect(context).toContain(buildPreferencesContext(pluginDir, undefined));
    // The retired-preferences notice names the hook's cwd, which is backslashed on Windows; nothing else may carry an escape.
    expect(context.replace(/removed — .* is no longer read/, "")).not.toMatch(/\\[nrt]/);
  });
});
