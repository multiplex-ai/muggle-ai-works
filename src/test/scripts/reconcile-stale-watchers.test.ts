import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const toBash = (p: string) => p.replace(/\\/g, "/");

const scriptPath = toBash(
  fileURLToPath(new URL("../../../plugin/scripts/reconcile-stale-watchers.sh", import.meta.url)),
);

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

const OWNING_SESSION_ID = "session-owner-aaa";
const FOREIGN_SESSION_ID = "session-other-bbb";

interface SlotFixture {
  slug: string;
  ownerSessionId?: string;
  isFinalized?: boolean;
}

function seedSessionsDir(slots: SlotFixture[]): string {
  const home = mkdtempSync(join(tmpdir(), "muggle-reconcile-home-"));
  const sessions = join(home, ".muggle-ai", "muggle-do", "sessions");
  mkdirSync(sessions, { recursive: true });

  for (const slot of slots) {
    const slotDir = join(sessions, slot.slug);
    mkdirSync(slotDir, { recursive: true });
    writeFileSync(join(slotDir, "prs.json"), "[]");
    if (slot.ownerSessionId !== undefined) {
      writeFileSync(
        join(slotDir, "owner.json"),
        JSON.stringify({ session_id: slot.ownerSessionId, claimed_at: "2026-08-12T00:00:00Z" }),
      );
    }
    if (slot.isFinalized === true) {
      writeFileSync(join(slotDir, "result.md"), "# done");
    }
  }
  return home;
}

function runHook(home: string, sessionId: string | null): string {
  return execFileSync("bash", [scriptPath], {
    env: { ...process.env, HOME: toBash(home), CLAUDE_PLUGIN_ROOT: "x" },
    input: sessionId === null ? "{}" : JSON.stringify({ session_id: sessionId }),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  });
}

describe.skipIf(!hasBash)("reconcile-stale-watchers.sh", () => {
  it("counts only this session's slots as re-armable and reports the rest as orphans", () => {
    const home = seedSessionsDir([
      { slug: "mine-pr1", ownerSessionId: OWNING_SESSION_ID },
      { slug: "theirs-pr2", ownerSessionId: FOREIGN_SESSION_ID },
      { slug: "legacy-pr3" },
    ]);

    const nudge = runHook(home, OWNING_SESSION_ID);

    expect(nudge).toContain("1 open watcher owned by this session");
    expect(nudge).toContain("2 open slots are owned by other sessions");
    expect(nudge).toContain("never re-arm them");
  }, 30_000);

  it("treats a slot with no owner.json as foreign, so legacy slots are never adopted", () => {
    const home = seedSessionsDir([{ slug: "legacy-pr1" }, { slug: "legacy-pr2" }]);

    const nudge = runHook(home, OWNING_SESSION_ID);

    expect(nudge).toContain("no watchers belong to this session");
    expect(nudge).toContain("2 open slots are owned by other sessions");
  }, 30_000);

  it("fails closed when the payload carries no session id", () => {
    const home = seedSessionsDir([{ slug: "mine-pr1", ownerSessionId: OWNING_SESSION_ID }]);

    const nudge = runHook(home, null);

    expect(nudge).toContain("no watchers belong to this session");
    expect(nudge).toContain("1 open slot is owned by other sessions");
  }, 30_000);

  it("ignores stopped slots, which the owner deliberately killed", () => {
    const home = seedSessionsDir([
      { slug: "killed-pr1.stopped", ownerSessionId: OWNING_SESSION_ID },
      { slug: "killed-pr2.stopped" },
    ]);

    const nudge = runHook(home, OWNING_SESSION_ID);

    expect(nudge).toBe("");
  }, 30_000);

  it("ignores finalized slots and stays silent when nothing is open", () => {
    const home = seedSessionsDir([
      { slug: "done-pr1", ownerSessionId: OWNING_SESSION_ID, isFinalized: true },
      { slug: "done-pr2", ownerSessionId: FOREIGN_SESSION_ID, isFinalized: true },
    ]);

    const nudge = runHook(home, OWNING_SESSION_ID);

    expect(nudge).toBe("");
  }, 30_000);
});
