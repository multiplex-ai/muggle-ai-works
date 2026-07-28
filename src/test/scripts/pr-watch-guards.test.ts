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

  it("falls back to the 6h default cap when max is omitted", () => {
    expect(runGuard("watcher_lifetime_exceeded 0 21600")).toBe(0);
    expect(runGuard("watcher_lifetime_exceeded 0 21599")).toBe(1);
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
