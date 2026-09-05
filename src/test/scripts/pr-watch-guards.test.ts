import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const toBash = (p: string) => p.replace(/\\/g, "/");

const scriptPath = toBash(
  fileURLToPath(new URL("../../../plugin/scripts/pr-watch-guards.sh", import.meta.url)),
);

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

// Run a bash snippet with the guard library sourced and a fresh slot dir exposed
// as $SLOT. Returns the guard's exit status (0 = predicate true).
function runGuard(snippet: string, pidFile?: string): number {
  const slot = mkdtempSync(join(tmpdir(), "pr-watch-slot-"));
  if (pidFile !== undefined) writeFileSync(join(slot, "watch.pid"), pidFile);
  try {
    execFileSync("bash", ["-c", `source "$SCRIPT"; ${snippet}`], {
      env: { ...process.env, SCRIPT: scriptPath, SLOT: toBash(slot) },
      stdio: "ignore",
    });
    return 0;
  } catch (e: unknown) {
    return (e as { status?: number }).status ?? 1;
  }
}

// Same as runGuard, plus an owner.json — the lease-ownership guard reads both.
//
// `livePid` writes the pid from *inside* bash rather than passing Node's
// `process.pid`. Under Git Bash `kill -0` resolves MSYS pids, not Win32 ones, so
// a Node pid is reported dead there and the guard would never see a live lease.
function runLeaseGuard(
  currentSession: string,
  pid: "live" | "dead" | "absent",
  ownerSession?: string,
): number {
  const slot = mkdtempSync(join(tmpdir(), "pr-watch-slot-"));
  if (pid === "dead") writeFileSync(join(slot, "watch.pid"), "999999999");
  if (ownerSession !== undefined) {
    writeFileSync(join(slot, "owner.json"), JSON.stringify({ session_id: ownerSession }, null, 2));
  }
  const seedLivePid = pid === "live" ? 'echo $$ > "$SLOT/watch.pid"; ' : "";
  try {
    execFileSync(
      "bash",
      ["-c", `source "$SCRIPT"; ${seedLivePid}watcher_lease_is_foreign "$SLOT" "$CURRENT"`],
      {
        env: { ...process.env, SCRIPT: scriptPath, SLOT: toBash(slot), CURRENT: currentSession },
        stdio: "ignore",
      },
    );
    return 0;
  } catch (e: unknown) {
    return (e as { status?: number }).status ?? 1;
  }
}

describe.skipIf(!hasBash)("pr-watch-guards.sh watcher_superseded", () => {
  it("is false when no watch.pid exists (loop not yet claimed)", () => {
    expect(runGuard('watcher_superseded "$SLOT" 111')).toBe(1);
  });

  it("is false when watch.pid names this loop", () => {
    expect(runGuard('watcher_superseded "$SLOT" 111', "111")).toBe(1);
  });

  it("is true when watch.pid names a different, newer watcher", () => {
    expect(runGuard('watcher_superseded "$SLOT" 111', "222")).toBe(0);
  });

  it("is false when watch.pid is empty", () => {
    expect(runGuard('watcher_superseded "$SLOT" 111', "")).toBe(1);
  });
});

describe.skipIf(!hasBash)("pr-watch-guards.sh watcher_lifetime_exceeded", () => {
  it("is true once elapsed reaches the cap", () => {
    expect(runGuard("watcher_lifetime_exceeded 1000 22600 21600")).toBe(0);
  });

  it("is false before the cap", () => {
    expect(runGuard("watcher_lifetime_exceeded 1000 21000 21600")).toBe(1);
  });

  it("falls back to the 7d default cap when max is omitted", () => {
    expect(runGuard("watcher_lifetime_exceeded 0 604800")).toBe(0);
    expect(runGuard("watcher_lifetime_exceeded 0 604799")).toBe(1);
  });

  it("treats a zero cap as unbounded rather than already expired", () => {
    // `never` exports 0. Read as a cap, the arithmetic would make every loop
    // exit on its first iteration — the opposite of what the setting means.
    expect(runGuard("watcher_lifetime_exceeded 0 999999999 0")).toBe(1);
    expect(runGuard("watcher_lifetime_exceeded 1000 1001 0")).toBe(1);
  });

  it("lets an explicit env override beat the default", () => {
    expect(runGuard("watcher_lifetime_exceeded 0 90000 86400")).toBe(0);
    expect(runGuard("watcher_lifetime_exceeded 0 80000 86400")).toBe(1);
  });
});

describe.skipIf(!hasBash)("pr-watch-guards.sh watcher_pid_alive", () => {
  it("is true for this shell's own PID", () => {
    expect(runGuard('watcher_pid_alive "$$"')).toBe(0);
  });

  it("is false for an empty PID", () => {
    expect(runGuard('watcher_pid_alive ""')).toBe(1);
  });

  it("is false for a PID that is not running", () => {
    expect(runGuard("watcher_pid_alive 2147483646")).toBe(1);
  });
});

describe.skipIf(!hasBash)("pr-watch-guards.sh MUGGLE_PR_WATCH_MAX_FETCH_FAILURES", () => {
  it("defaults to 60 (hours of outage tolerance with back-off)", () => {
    expect(runGuard('[ "$MUGGLE_PR_WATCH_MAX_FETCH_FAILURES" = "60" ]')).toBe(0);
  });
});

describe.skipIf(!hasBash)("pr-watch-guards.sh watcher_fetch_backoff", () => {
  it("is the poll interval on the first failure", () => {
    expect(runGuard('[ "$(watcher_fetch_backoff 0)" = "60" ]')).toBe(0);
  });

  it("grows linearly with the failure count", () => {
    expect(runGuard('[ "$(watcher_fetch_backoff 4)" = "180" ]')).toBe(0);
  });

  it("caps at 5 minutes", () => {
    expect(runGuard('[ "$(watcher_fetch_backoff 100)" = "300" ]')).toBe(0);
  });
});

describe.skipIf(!hasBash)("pr-watch-guards.sh watcher_unseeded_too_long", () => {
  // A slot with no watch-watermark.env cannot evaluate a single wake condition,
  // so the loop reports nothing and never reaches its terminal check — while
  // still holding the PID lease and touching the heartbeat that reconcile reads
  // as proof of health. The cap is what turns that silent no-op into a failure.
  it("is false while the arming session still has time to seed", () => {
    expect(runGuard("watcher_unseeded_too_long 60")).toBe(1);
  });

  it("is true once the wait passes the cap", () => {
    expect(runGuard("watcher_unseeded_too_long 180")).toBe(0);
  });

  it("takes an explicit cap over the default", () => {
    expect(runGuard("watcher_unseeded_too_long 30 20")).toBe(0);
  });

  // 0 is unbounded, matching watcher_lifetime_exceeded, rather than "already
  // expired" — which would kill every loop on its first pass.
  it("treats a cap of 0 as unbounded", () => {
    expect(runGuard("watcher_unseeded_too_long 99999 0")).toBe(1);
  });

  it("defaults to 180 seconds", () => {
    expect(runGuard('[ "$MUGGLE_PR_WATCH_MAX_UNSEEDED" = "180" ]')).toBe(0);
  });
});

describe.skipIf(!hasBash)("pr-watch-guards.sh watcher_lease_is_foreign", () => {
  // A live PID belonging to a dead session is the deaf orphan: still polling,
  // still touching its heartbeat, writing into a monitor pipe nobody reads.
  it("is true when a live lease belongs to another session", () => {
    expect(runLeaseGuard("mine", "live", "theirs")).toBe(0);
  });

  it("is false when the live lease belongs to the arming session", () => {
    expect(runLeaseGuard("mine", "live", "mine")).toBe(1);
  });

  // Every unknown answers false: a slot is never reclaimed on a guess.
  it("is false when the PID is dead, whoever owns it", () => {
    expect(runLeaseGuard("mine", "dead", "theirs")).toBe(1);
  });

  it("is false when no owner.json records who armed it", () => {
    expect(runLeaseGuard("mine", "live")).toBe(1);
  });

  it("is false when no watch.pid exists", () => {
    expect(runLeaseGuard("mine", "absent", "theirs")).toBe(1);
  });

  it("is false when the arming session has no id to compare", () => {
    expect(runLeaseGuard("", "live", "theirs")).toBe(1);
  });
});
