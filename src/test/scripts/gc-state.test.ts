import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const toBash = (p: string) => p.replace(/\\/g, "/");

const scriptPath = toBash(
  fileURLToPath(new URL("../../../plugin/scripts/gc-state.sh", import.meta.url)),
);

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

function seedFile(path: string, ageDays: number): void {
  writeFileSync(path, "x");
  const t = daysAgo(ageDays);
  utimesSync(path, t, t);
}

describe.skipIf(!hasBash)("gc-state.sh", () => {
  it("prunes only stale ephemeral state, keeping fresh files and open slots", () => {
    const home = mkdtempSync(join(tmpdir(), "muggle-gc-home-"));
    const guardrails = join(home, ".muggle-ai", "guardrails");
    const sessions = join(home, ".muggle-ai", "muggle-do", "sessions");
    mkdirSync(guardrails, { recursive: true });
    mkdirSync(sessions, { recursive: true });

    const oldJson = join(guardrails, "old-session.json");
    const freshJson = join(guardrails, "fresh-session.json");
    seedFile(oldJson, 20);
    seedFile(freshJson, 1);

    // Finalized + old → pruned. Finalized + fresh → kept. Open + old → kept.
    const termOld = join(sessions, "terminal-old");
    const termFresh = join(sessions, "terminal-fresh");
    const openOld = join(sessions, "open-old");
    for (const [dir, age, finalized] of [
      [termOld, 40, true],
      [termFresh, 1, true],
      [openOld, 40, false],
    ] as const) {
      mkdirSync(dir, { recursive: true });
      seedFile(join(dir, "prs.json"), age);
      if (finalized) seedFile(join(dir, "result.md"), age);
    }

    execFileSync("bash", [scriptPath], {
      env: { ...process.env, HOME: toBash(home), MUGGLE_STATE_GC_FORCE: "1" },
      stdio: "ignore",
    });

    expect(existsSync(oldJson)).toBe(false);
    expect(existsSync(freshJson)).toBe(true);
    expect(existsSync(termOld)).toBe(false);
    expect(existsSync(termFresh)).toBe(true);
    expect(existsSync(openOld)).toBe(true);
  });

  it("is a no-op when the TTL marker is fresh (gate closed)", () => {
    const home = mkdtempSync(join(tmpdir(), "muggle-gc-home-"));
    const guardrails = join(home, ".muggle-ai", "guardrails");
    const markerDir = join(home, ".cache", "muggle");
    mkdirSync(guardrails, { recursive: true });
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(join(markerDir, "state-gc-checked"), ""); // fresh marker

    const oldJson = join(guardrails, "old-session.json");
    seedFile(oldJson, 20);

    execFileSync("bash", [scriptPath], {
      env: { ...process.env, HOME: toBash(home) }, // no FORCE → honor the gate
      stdio: "ignore",
    });

    expect(existsSync(oldJson)).toBe(true); // gate closed, nothing pruned
  });
});
