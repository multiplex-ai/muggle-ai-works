import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const toBash = (p: string) => p.replace(/\\/g, "/");

const armPath = toBash(fileURLToPath(new URL("../../../plugin/scripts/pr-watch-arm.sh", import.meta.url)));

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
