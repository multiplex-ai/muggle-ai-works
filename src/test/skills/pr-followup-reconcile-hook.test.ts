/**
 * Static wiring lint for the session-start reconcile nudge. muggle-pr-followup
 * watchers are session-only crons, so open PRs accumulate dead watchers with
 * nothing to notice; a SessionStart hook closes that gap by nudging reconcile
 * when open slots exist. This test locks the wiring — the hook is registered and
 * points at the script, and the script nudges only when a non-terminal slot
 * exists (never when clean).
 *
 * It also locks the nudge's **scope**: only slots this session owns count as
 * recoverable, since re-arming a watcher armed by a different session hands PR
 * review work to a session with no context for it. Behavioral coverage of the
 * partition lives in `../scripts/reconcile-stale-watchers.test.ts`; this file
 * reads the files and does not run the hook.
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
      const emptyGuard = script.search(
        /owned_count["'}]?\s*-eq\s*0\s*\]\s*&&\s*\[\s*["'$]*orphan_count["'}]?\s*-eq\s*0/,
      );
      const emit = script.indexOf("additionalContext");
      expect(emptyGuard, "no zero-slot guard found").toBeGreaterThan(-1);
      expect(emit, "no additionalContext emission found").toBeGreaterThan(-1);
      expect(
        emptyGuard,
        "the zero-slot exit must come before any nudge is printed",
      ).toBeLessThan(emit);
    });

    it("skips *.stopped slots — the owner's kill switch keeps its prs.json", () => {
      expect(script).toMatch(/\*\.stopped/);
    });

    it("partitions slots by owner.json against the payload's session_id", () => {
      expect(script).toMatch(/owner\.json/);
      expect(script).toMatch(/session_id/);
      // The equality gate: a slot counts as owned only on an exact id match.
      expect(script).toMatch(/"\$slot_owner"\s*=\s*"\$current_session_id"/);
    });

    it("fails closed — an unidentifiable session owns nothing", () => {
      // A non-empty current id is required before any slot can be called owned,
      // so a payload with no session_id yields zero owned and re-arms nothing.
      expect(script).toMatch(/-n\s+"\$current_session_id"\s*\]\s*&&/);
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

    it("reconcile.md scopes the log beacon to tick lines — logging is not polling", () => {
      // An armed/re-armed announcement or cycle note is written by a session
      // that may die the next instant; if it counted as liveness, a dead slot
      // would sit unwatched for the whole staleness window (and auto-track,
      // which skips existing slots, would never catch it either).
      expect(reconcile).toMatch(/newest \*\*tick line\*\*/);
      expect(reconcile).toMatch(/Non-tick lines are \*\*not\*\* beacons/);
      expect(reconcile).toMatch(/logging is not polling/);
      expect(reconcile).not.toMatch(/newest ISO-8601 line in `followup\.log`/);
    });

    it("SKILL.md notes reconcile is also triggered at session start", () => {
      expect(skill).toMatch(/session start/i);
      expect(skill).toMatch(/SessionStart|session-start hook/i);
    });

    // Watching is session-scoped by design (owner decision): nothing polls out
    // of session, because a review is addressed only inside a session that
    // carries the context. No out-of-session watchdog daemon, ever.
    it("no skill doc resurrects an out-of-session watchdog", () => {
      for (const [name, body] of [
        ["reconcile.md", reconcile],
        ["SKILL.md", skill],
        ["arm-watcher.md", read(path.join(SKILL_DIR, "arm-watcher.md"))],
        ["contract.md", read(path.join(SKILL_DIR, "contract.md"))],
        ["state-schemas.md", read(path.join(SKILL_DIR, "state-schemas.md"))],
        ["stop.md", read(path.join(SKILL_DIR, "stop.md"))],
      ] as const) {
        expect(/watchdog/i.test(body), `${name} still names a watchdog`).toBe(false);
        expect(/headless.*(recovery )?tick|claude -p/i.test(body), `${name} still spawns headless ticks`).toBe(false);
      }
    });

    it("reconcile.md documents session-scoped recovery — session down, watchers down; owning session up, re-armed", () => {
      expect(reconcile).toMatch(/session-scoped/i);
      expect(reconcile).toMatch(/context to address it/i);
      expect(reconcile).toMatch(/owner\.json/);
    });

    // The defect this gate exists to prevent: a fresh session running reconcile
    // (directly, via auto-track's Step 0, or from the session-start nudge) used
    // to adopt every open slot on disk, so it polled and pushed to PRs it had no
    // context for. Recovery is bounded by ownership, and only an explicit adopt
    // moves a slot between sessions.
    it("reconcile.md re-arms only what the running session owns, and never adopts", () => {
      expect(reconcile).toMatch(/Never adopts/i);
      expect(reconcile).toMatch(/\$CLAUDE_CODE_SESSION_ID/);
      expect(reconcile).toMatch(/foreign/i);
      expect(reconcile).toMatch(/adopt\.md/);
    });

    it("reconcile.md still finalizes terminal slots regardless of owner", () => {
      expect(reconcile).toMatch(/owned or foreign alike/i);
      expect(reconcile).toMatch(/ownership-free/i);
    });

    it("adopt.md exists and is explicit, single-slot, and stop-respecting", () => {
      const adopt = read(path.join(SKILL_DIR, "adopt.md"));
      expect(adopt).toMatch(/Explicit only/i);
      expect(adopt).toMatch(/One slot per invocation/i);
      expect(adopt).toMatch(/\.stopped/);
      expect(adopt).toMatch(/owner\.json/);
    });

    it("SKILL.md routes adopt and states watchers belong to the arming session", () => {
      expect(skill).toMatch(/adopt\.md/);
      expect(skill).toMatch(/owner\.json/);
    });

    it("auto-track.md's reconcile step cannot widen what the session watches", () => {
      const autoTrack = read(path.join(SKILL_DIR, "auto-track.md"));
      expect(autoTrack).toMatch(/recover, never widen/i);
    });

    // The loop used to be re-authored from this prose on every arm, and the
    // derivations disagreed — two of four slots on one machine lacked the
    // behind-base wake, leaving their PRs unmergeable under a healthy-looking
    // watcher. Arming must run the shipped loop, never write one.
    it("arm-watcher.md runs the shipped loop instead of authoring a per-slot watch.sh", () => {
      const armWatcher = read(path.join(SKILL_DIR, "arm-watcher.md"));
      expect(armWatcher).toMatch(/pr-watch-loop\.sh/);
      expect(armWatcher).toMatch(/Never author a per-slot `watch\.sh`/i);
    });

    it("the shipped loop and its wake conditions exist as real files", () => {
      const scriptsDir = path.join(REPO_ROOT, "plugin", "scripts");
      expect(fs.existsSync(path.join(scriptsDir, "pr-watch-loop.sh"))).toBe(true);
      expect(fs.existsSync(path.join(scriptsDir, "pr-watch-events.sh"))).toBe(true);
    });

    it("the shipped rebase wake covers behind, not just conflict", () => {
      const events = read(path.join(REPO_ROOT, "plugin", "scripts", "pr-watch-events.sh"));
      expect(events).toMatch(/behind_count/);
      expect(events).toMatch(/CONFLICTING/);
      // Both halves in one function: dropping either is what regressed before.
      expect(events).toMatch(/watch_wake_rebase\(\)/);
    });

    it("hooks README documents the nudge script", () => {
      expect(readme).toMatch(/reconcile-stale-watchers\.sh/);
    });
  });
});
