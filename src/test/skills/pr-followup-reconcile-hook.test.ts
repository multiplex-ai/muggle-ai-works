/**
 * Static wiring lint for the session-start reconcile nudge. muggle-pr-followup
 * watchers are session-only crons, so open PRs accumulate dead watchers with
 * nothing to notice; a SessionStart hook closes that gap by nudging reconcile
 * when open slots exist. This test locks the wiring — the hook is registered and
 * points at the script, and the script nudges only when a non-terminal slot
 * exists (never when clean). It reads the files; it does not run the hook.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILL_DIR = path.join(REPO_ROOT, "plugin", "skills", "muggle-pr-followup");
const SCRIPT = path.join(
  REPO_ROOT,
  "plugin",
  "scripts",
  "reconcile-stale-watchers.sh",
);
const HOOKS_JSON = path.join(REPO_ROOT, "plugin", "hooks", "hooks.json");
const HOOKS_README = path.join(REPO_ROOT, "plugin", "hooks", "README.md");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("pr-followup session-start reconcile nudge", () => {
  it("the nudge script exists", () => {
    expect(fs.existsSync(SCRIPT)).toBe(true);
  });

  const script = fs.existsSync(SCRIPT) ? read(SCRIPT) : "";

  describe("hooks.json registers it as a SessionStart command", () => {
    const hooks = JSON.parse(read(HOOKS_JSON));
    const sessionStart = (hooks.hooks?.SessionStart ?? []) as Array<{
      matcher?: string;
      hooks: Array<{ command: string }>;
    }>;

    it("a SessionStart entry runs reconcile-stale-watchers.sh", () => {
      const commands = sessionStart.flatMap((e) =>
        e.hooks.map((h) => h.command),
      );
      expect(
        commands.some((c) => c.includes("reconcile-stale-watchers.sh")),
        "no SessionStart hook invokes reconcile-stale-watchers.sh",
      ).toBe(true);
    });

    it("shares the startup|clear|compact matcher with the existing ensure-electron-app hook", () => {
      const entry = sessionStart.find((e) =>
        e.hooks.some((h) => h.command.includes("reconcile-stale-watchers.sh")),
      );
      expect(entry?.matcher).toBe("startup|clear|compact");
      // Registered alongside — the existing hook must survive the addition.
      expect(
        entry?.hooks.some((h) =>
          h.command.includes("ensure-electron-app.sh"),
        ),
      ).toBe(true);
    });
  });

  describe("the script nudges reconcile, and only when a slot is non-terminal", () => {
    it("dispatches the skill's reconcile mode", () => {
      expect(script).toMatch(
        /\/muggle:muggle-pr-followup\s+reconcile/,
      );
    });

    it("scans slots under the user's home", () => {
      expect(script).toMatch(/\$\{HOME\}/);
      expect(script).toMatch(/muggle-do\/sessions/);
    });

    it("keys an open slot on prs.json present and result.md absent", () => {
      expect(script).toMatch(/-f\s+[^\n]*prs\.json/);
      expect(script).toMatch(/!\s*-f\s+[^\n]*result\.md/);
    });

    it("emits nothing when no open slot exists — the empty-state exit precedes any context emission", () => {
      const emptyGuard = script.search(/stale_count["'}]?\s*-eq\s*0/);
      const emit = script.indexOf("additionalContext");
      expect(emptyGuard, "no zero-slot guard found").toBeGreaterThan(-1);
      expect(emit, "no additionalContext emission found").toBeGreaterThan(-1);
      expect(
        emptyGuard,
        "the zero-slot exit must come before any nudge is printed",
      ).toBeLessThan(emit);
    });

    it("emits the SessionStart additionalContext contract when slots exist", () => {
      expect(script).toMatch(/hookSpecificOutput/);
      expect(script).toMatch(/"hookEventName":\s*"SessionStart"/);
      expect(script).toMatch(/additionalContext/);
    });

    it("is a pure scan — no gh, no network", () => {
      // Strip full-line comments so prose ("no gh, no writes") isn't read as a call.
      const code = script
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      expect(/\bgh\b/.test(code)).toBe(false);
      expect(/\bcurl\b|\bwget\b|npm\s+view/.test(code)).toBe(false);
    });
  });

  describe("docs reflect the new trigger", () => {
    const reconcile = read(path.join(SKILL_DIR, "reconcile.md"));
    const skill = read(path.join(SKILL_DIR, "SKILL.md"));
    const readme = read(HOOKS_README);

    it("reconcile.md documents the session-start trigger and keeps recover-don't-seed", () => {
      expect(reconcile).toMatch(/session start/i);
      expect(reconcile).toMatch(/reconcile-stale-watchers\.sh/);
      // The invariant this feature must not weaken.
      expect(reconcile).toMatch(/Recover,?\s*don'?t\s*seed/i);
    });

    it("SKILL.md notes reconcile is also triggered at session start", () => {
      expect(skill).toMatch(/session start/i);
      expect(skill).toMatch(/SessionStart|session-start hook/i);
    });

    it("hooks README documents the nudge script", () => {
      expect(readme).toMatch(/reconcile-stale-watchers\.sh/);
    });
  });
});
