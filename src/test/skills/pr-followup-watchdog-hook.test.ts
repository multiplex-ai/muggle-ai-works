/**
 * Static wiring lint for the out-of-session watchdog. Watch monitors and
 * recovery crons are session-bound — a usage-limit hit kills them mid-watch,
 * and every reconcile trigger needs a live session, so nothing recovers until
 * a human returns. The watchdog daemon closes that gap; this test locks its
 * wiring: the ensure hook is registered, the bundle is built from
 * src/watchdog/, and the skill docs carry the heartbeat + watchdog contract.
 * It reads the files; it does not run the daemon.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILL_DIR = path.join(REPO_ROOT, "plugin", "skills", "muggle-pr-followup");
const ENSURE_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "ensure-pr-watchdog.sh");
const HOOKS_JSON = path.join(REPO_ROOT, "plugin", "hooks", "hooks.json");
const HOOKS_README = path.join(REPO_ROOT, "plugin", "hooks", "README.md");
const TSUP_CONFIG = path.join(REPO_ROOT, "tsup.config.ts");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("pr-followup out-of-session watchdog wiring", () => {
  it("the ensure wrapper exists", () => {
    expect(fs.existsSync(ENSURE_SCRIPT)).toBe(true);
  });

  const ensureScript = fs.existsSync(ENSURE_SCRIPT) ? read(ENSURE_SCRIPT) : "";

  describe("hooks.json registers the ensure wrapper at SessionStart", () => {
    const hooks = JSON.parse(read(HOOKS_JSON));
    const sessionStart = (hooks.hooks?.SessionStart ?? []) as Array<{
      matcher?: string;
      hooks: Array<{ command: string }>;
    }>;

    it("a SessionStart entry runs ensure-pr-watchdog.sh", () => {
      const commands = sessionStart.flatMap((e) => e.hooks.map((h) => h.command));
      expect(
        commands.some((c) => c.includes("ensure-pr-watchdog.sh")),
        "no SessionStart hook invokes ensure-pr-watchdog.sh",
      ).toBe(true);
    });

    it("registered alongside the reconcile nudge — the nudge must survive the addition", () => {
      const entry = sessionStart.find((e) =>
        e.hooks.some((h) => h.command.includes("ensure-pr-watchdog.sh")),
      );
      expect(entry?.hooks.some((h) => h.command.includes("reconcile-stale-watchers.sh"))).toBe(
        true,
      );
    });
  });

  describe("the ensure wrapper", () => {
    it("only acts when an open slot exists — the empty-state exit precedes the node call", () => {
      // Strip full-line comments so prose naming the bundle isn't read as the call.
      const code = ensureScript
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      const emptyGuard = code.search(/open_slot_exists["'}]?\s*-eq\s*0/);
      const nodeCall = code.indexOf("pr-followup-watchdog.mjs");
      expect(emptyGuard).toBeGreaterThan(-1);
      expect(nodeCall).toBeGreaterThan(-1);
      expect(emptyGuard).toBeLessThan(nodeCall);
    });

    it("keys an open slot on prs.json present and result.md absent", () => {
      expect(ensureScript).toMatch(/-f\s+[^\n]*prs\.json/);
      expect(ensureScript).toMatch(/!\s*-f\s+[^\n]*result\.md/);
    });

    it("invokes the bundle's ensure subcommand and degrades silently", () => {
      expect(ensureScript).toMatch(/pr-followup-watchdog\.mjs"\s+ensure/);
      expect(ensureScript).toMatch(/\|\|\s*true/);
    });
  });

  describe("the daemon bundle", () => {
    it("tsup builds src/watchdog/cli.ts into plugin/scripts/pr-followup-watchdog.mjs", () => {
      const tsupConfig = read(TSUP_CONFIG);
      expect(tsupConfig).toMatch(/"pr-followup-watchdog":\s*"src\/watchdog\/cli\.ts"/);
    });

    it("the daemon spawns the skill's tick mode headlessly", () => {
      const daemonSource = read(path.join(REPO_ROOT, "src", "watchdog", "cli.ts"));
      expect(daemonSource).toMatch(/\/muggle:muggle-pr-followup \$\{slot\.slug\}/);
    });

    it("the daemon never resurrects a user-neutralized (.stopped) slot", () => {
      const daemonSource = read(path.join(REPO_ROOT, "src", "watchdog", "cli.ts"));
      expect(daemonSource).toMatch(/endsWith\("\.stopped"\)/);
    });
  });

  describe("skill docs carry the contract", () => {
    const armWatcher = read(path.join(SKILL_DIR, "arm-watcher.md"));
    const reconcile = read(path.join(SKILL_DIR, "reconcile.md"));
    const stateSchemas = read(path.join(SKILL_DIR, "state-schemas.md"));
    const skill = read(path.join(SKILL_DIR, "SKILL.md"));
    const readme = read(HOOKS_README);

    it("arm-watcher documents the heartbeat touch and the arm-time ensure", () => {
      expect(armWatcher).toMatch(/watch-heartbeat/);
      expect(armWatcher).toMatch(/pr-followup-watchdog\.mjs ensure/);
    });

    it("reconcile documents the watchdog and the beacon liveness rule", () => {
      expect(reconcile).toMatch(/## Out-of-session watchdog/);
      expect(reconcile).toMatch(/watch-heartbeat/);
      // The invariant the watchdog must not weaken.
      expect(reconcile).toMatch(/Recover,?\s*don'?t\s*seed/i);
    });

    it("state-schemas documents watch-heartbeat and watchdog.json", () => {
      expect(stateSchemas).toMatch(/## `watch-heartbeat`/);
      expect(stateSchemas).toMatch(/## `watchdog\.json`/);
      expect(stateSchemas).toMatch(/last_spawn_signature/);
    });

    it("SKILL.md explains session death and the surviving substrate", () => {
      expect(skill).toMatch(/\*\*Session death\.\*\*/);
      expect(skill).toMatch(/usage limit/i);
    });

    it("hooks README documents the ensure hook", () => {
      expect(readme).toMatch(/ensure-pr-watchdog\.sh/);
      expect(readme).toMatch(/pr-followup-watchdog\.mjs/);
    });
  });
});
