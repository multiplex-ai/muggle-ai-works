import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const toBash = (p: string) => p.replace(/\\/g, "/");

const armPath = toBash(fileURLToPath(new URL("../../../plugin/scripts/pr-watch-arm.sh", import.meta.url)));
const guardsPath = toBash(
  fileURLToPath(new URL("../../../plugin/scripts/pr-watch-guards.sh", import.meta.url)),
);

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

// Runs the arm script and returns its exit status. Only argument handling is
// exercised here: everything past validation needs a live PR.
function runArm(args: string[]): number {
  try {
    execFileSync("bash", [armPath, ...args], { stdio: "ignore" });
    return 0;
  } catch (e: unknown) {
    return (e as { status?: number }).status ?? 1;
  }
}

describe.skipIf(!hasBash)("pr-watch-arm.sh arguments", () => {
  it("refuses to run with no arguments", () => {
    expect(runArm([])).toBe(2);
  });

  it("refuses a partial slot specification", () => {
    expect(runArm(["--slot", "/tmp/whatever", "--repo", "owner/name"])).toBe(2);
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(
      runArm(["--slot", "/tmp/x", "--repo", "o/n", "--pr", "1", "--base", "master", "--wat"]),
    ).toBe(2);
  });
});

describe.skipIf(!hasBash)("pr-watch-arm.sh contract", () => {
  const body = readFileSync(armPath, "utf8");

  // The whole point of the script: the three arming steps cannot be performed
  // separately, because performing them separately is how the watermark got
  // dropped and the watch became a silent no-op.
  it("seeds every watermark key the loop reads", () => {
    ["REV=", "COM=", "THREADS=", "CIRED=", "REBASED=", "BLOCKED_CIDIGEST="].forEach((key) => {
      expect(body).toContain(key);
    });
  });

  it("writes the watermark into the slot", () => {
    expect(body).toContain("watch-watermark.env");
  });

  it("hands over to the loop rather than reimplementing it", () => {
    expect(body).toContain("pr-watch-loop.sh");
    expect(body).toContain("exec bash");
  });

  // A merged or closed PR has nothing to watch, and arming one would leave a
  // slot that never terminates because its first fetch already passed.
  it("stops on a terminal PR instead of arming", () => {
    expect(body).toContain("TERMINAL pr=");
  });

  // Seeding floors from a failed read would mark the entire backlog as seen.
  it("refuses to seed floors it could not read", () => {
    expect(body).toContain("ARM-FAIL");
  });
});

// The claim happens after the state fetch, so reaching it needs the two calls
// arming makes: the tab-separated state projection and the behind-by compare.
function stubGhDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pr-watch-gh-"));
  const gh = join(dir, "gh");
  writeFileSync(
    gh,
    [
      "#!/usr/bin/env bash",
      'if [ "$1" = "auth" ]; then echo stub-token; exit 0; fi',
      'if [ "$1" = "api" ] && [ "$2" = "graphql" ]; then',
      "  printf 'OPEN\\tHEAD1\\tBASE1\\tMERGEABLE\\t0\\t0\\t\\t0\\t0\\t\\n'",
      "  exit 0",
      "fi",
      "echo 0",
      "",
    ].join("\n"),
  );
  chmodSync(gh, 0o755);
  return dir;
}

// Arms a fresh slot with --no-exec and returns it. An omitted `session` runs the
// script with CLAUDE_CODE_SESSION_ID absent from the environment entirely.
//
// PATH is joined with the platform delimiter and native paths: a POSIX-joined
// PATH breaks locating `bash` itself on Windows, long before the stub matters.
function armSlot(session?: string): string {
  const slot = mkdtempSync(join(tmpdir(), "pr-watch-slot-"));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${stubGhDir()}${delimiter}${process.env.PATH ?? ""}`,
  };
  delete env.CLAUDE_CODE_SESSION_ID;
  if (session !== undefined) env.CLAUDE_CODE_SESSION_ID = session;
  execFileSync(
    "bash",
    [armPath, "--slot", toBash(slot), "--repo", "o/n", "--pr", "1", "--base", "master", "--no-exec"],
    { env: env, stdio: "ignore" },
  );
  return slot;
}

// Seeds the pid from inside bash: Git Bash's `kill -0` resolves MSYS pids, not
// Win32 ones, so a Node pid reads as dead and the guard sees no live lease.
function leaseIsForeign(slot: string, currentSession: string): boolean {
  try {
    execFileSync(
      "bash",
      [
        "-c",
        'source "$SCRIPT"; echo $$ > "$SLOT/watch.pid"; watcher_lease_is_foreign "$SLOT" "$CURRENT"',
      ],
      {
        env: { ...process.env, SCRIPT: guardsPath, SLOT: toBash(slot), CURRENT: currentSession },
        stdio: "ignore",
      },
    );
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasBash)("pr-watch-arm.sh slot ownership", () => {
  it("claims the slot for the arming session", () => {
    const owner = JSON.parse(readFileSync(join(armSlot("session-abc"), "owner.json"), "utf8"));
    expect(owner.session_id).toBe("session-abc");
    expect(owner.claimed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  // An unknowable id is worse than none: reconcile reads any id it does not
  // recognise as another session's claim, so a placeholder strands the slot.
  it("leaves the slot unowned when the session id is unset", () => {
    expect(existsSync(join(armSlot(), "owner.json"))).toBe(false);
  });

  // The defect this claim closes. Without owner.json the guard reads a live
  // lease as "not foreign", so every later arm skips the slot as already owned
  // and an orphaned watcher holds it until the lifetime cap.
  it("writes an owner a later session can reclaim", () => {
    expect(leaseIsForeign(armSlot("session-abc"), "session-xyz")).toBe(true);
  });

  it("does not hand the arming session its own lease as foreign", () => {
    expect(leaseIsForeign(armSlot("session-abc"), "session-abc")).toBe(false);
  });
});
