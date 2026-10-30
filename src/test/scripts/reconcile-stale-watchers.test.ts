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
  isRegistered?: boolean;
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
    if (slot.isRegistered === true) {
      writeFileSync(join(slotDir, "watch-registration.json"), "{}");
    }
  }
  return home;
}

function runHook(home: string, sessionId: string | null, bashArgs: string[] = [scriptPath]): string {
  return execFileSync("bash", bashArgs, {
    env: { ...process.env, HOME: toBash(home), CLAUDE_PLUGIN_ROOT: "x" },
    input: sessionId === null ? "{}" : JSON.stringify({ session_id: sessionId }),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  });
}

// The hook script, run by a bash whose PATH holds no programs, so anything but a builtin fails.
const BUILTINS_ONLY_BASH_ARGS = ["-c", 'PATH=/no-programs-on-this-path exec "$BASH" "$1"', "_", scriptPath];

describe.skipIf(!hasBash)("reconcile-stale-watchers.sh", () => {
  it("counts only this session's slots as re-armable and leaves the rest unmentioned", () => {
    const home = seedSessionsDir([
      { slug: "mine-pr1", ownerSessionId: OWNING_SESSION_ID },
      { slug: "theirs-pr2", ownerSessionId: FOREIGN_SESSION_ID },
      { slug: "legacy-pr3" },
    ]);

    const nudge = runHook(home, OWNING_SESSION_ID);

    expect(nudge).toContain("1 open watcher owned by this session");
    expect(nudge).not.toContain("other sessions");
  }, 30_000);

  // The hook speaks into every session start; one owning nothing has nothing to do.
  it("stays silent for a session that owns no slot", () => {
    const home = seedSessionsDir([
      { slug: "theirs-pr1", ownerSessionId: FOREIGN_SESSION_ID },
      { slug: "legacy-pr2" },
    ]);

    expect(runHook(home, OWNING_SESSION_ID)).toBe("");
  }, 30_000);

  // The service keeps a registered slot's loop without the session, so a sweep
  // pushed into a resumed or compacted session would only interrupt its work.
  it("stays silent about slots the muggle watch service keeps", () => {
    const home = seedSessionsDir([
      { slug: "mine-pr1", ownerSessionId: OWNING_SESSION_ID, isRegistered: true },
      { slug: "mine-pr2", ownerSessionId: OWNING_SESSION_ID, isRegistered: true },
    ]);

    expect(runHook(home, OWNING_SESSION_ID)).toBe("");
    const unkept = seedSessionsDir([
      { slug: "mine-pr1", ownerSessionId: OWNING_SESSION_ID, isRegistered: true },
      { slug: "mine-pr2", ownerSessionId: OWNING_SESSION_ID },
    ]);
    expect(runHook(unkept, OWNING_SESSION_ID)).toContain("1 open watcher owned by this session, not kept by the muggle watch service");
  }, 30_000);

  it("fails closed when the payload carries no session id", () => {
    const home = seedSessionsDir([{ slug: "mine-pr1", ownerSessionId: OWNING_SESSION_ID }]);

    expect(runHook(home, null)).toBe("");
  }, 30_000);

  it("ignores stopped slots, which the owner deliberately killed", () => {
    const home = seedSessionsDir([
      { slug: "killed-pr1.stopped", ownerSessionId: OWNING_SESSION_ID },
      { slug: "killed-pr2.stopped" },
    ]);

    const nudge = runHook(home, OWNING_SESSION_ID);

    expect(nudge).toBe("");
  }, 30_000);

  // Every open slot is visited on every session start, so a program started per slot is paid over and over.
  it("answers in bash builtins alone, however many slots are open", () => {
    const home = seedSessionsDir([
      { slug: "mine-pr1", ownerSessionId: OWNING_SESSION_ID },
      { slug: "theirs-pr2", ownerSessionId: FOREIGN_SESSION_ID },
      { slug: "legacy-pr3" },
    ]);

    const nudge = runHook(home, OWNING_SESSION_ID, BUILTINS_ONLY_BASH_ARGS);

    expect(nudge).toContain("1 open watcher owned by this session");
    expect(nudge).toBe(runHook(home, OWNING_SESSION_ID));
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
