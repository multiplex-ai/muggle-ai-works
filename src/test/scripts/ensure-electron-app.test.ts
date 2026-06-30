import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const toBash = (p: string) => p.replace(/\\/g, "/");

const scriptPath = toBash(
  fileURLToPath(new URL("../../../plugin/scripts/ensure-electron-app.sh", import.meta.url)),
);

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

// Run `snippet` in bash with the script and a throwaway file exposed as
// $SCRIPT / $TESTFILE. The script is sourced in lib-only mode so only its
// helpers load — the hook body (muggle setup, npm view, JSON output) never runs.
function runBash(snippet: string): { stdout: string; status: number } {
  const dir = mkdtempSync(join(tmpdir(), "ensure-electron-"));
  const file = join(dir, "marker");
  writeFileSync(file, "x");
  try {
    const stdout = execFileSync("bash", ["-c", snippet], {
      env: { ...process.env, SCRIPT: scriptPath, TESTFILE: toBash(file) },
      encoding: "utf-8",
    });
    return { stdout: stdout.trim(), status: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; status?: number };
    return {
      stdout: (err.stdout?.toString() ?? "").trim(),
      status: err.status ?? 1,
    };
  }
}

const load = 'MUGGLE_ENSURE_ELECTRON_LIB_ONLY=1 source "$SCRIPT";';

describe.skipIf(!hasBash)("ensure-electron-app.sh file_mtime", () => {
  it("returns the file's epoch mtime as a bare number", () => {
    const { stdout } = runBash(`${load} file_mtime "$TESTFILE"`);
    expect(stdout).toMatch(/^\d+$/);
  });

  it("returns 0 — never leaked junk — when stat exits non-zero with noise", () => {
    // Mimics GNU `stat -f` on Linux/Git Bash: writes a `File: ...` block to
    // stdout and exits non-zero. The old code appended this to the real mtime.
    const { stdout } = runBash(
      `stat() { printf 'File: junk\\n'; return 1; }; ${load} file_mtime "$TESTFILE"`,
    );
    expect(stdout).toBe("0");
  });

  it("rejects non-numeric stat output even when stat exits zero", () => {
    const { stdout } = runBash(
      `stat() { printf 'File: junk\\n'; return 0; }; ${load} file_mtime "$TESTFILE"`,
    );
    expect(stdout).toBe("0");
  });

  it("feeds the TTL arithmetic safely under set -u (the original crash)", () => {
    // Reproduces line 22: a non-numeric mtime here aborted with
    // `File: unbound variable`. With the fix, file_mtime yields a number.
    const { stdout, status } = runBash(
      `set -u; stat() { printf 'File: junk\\n'; return 0; }; ${load} ` +
        `now=$(date +%s); echo $((now - $(file_mtime "$TESTFILE")))`,
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(/^\d+$/);
  });

  it("matches node's view of the file mtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "ensure-electron-"));
    const file = join(dir, "marker");
    writeFileSync(file, "x");
    const expected = Math.floor(statSync(file).mtimeMs / 1000);
    const stdout = execFileSync("bash", ["-c", `${load} file_mtime "$TESTFILE"`], {
      env: { ...process.env, SCRIPT: scriptPath, TESTFILE: toBash(file) },
      encoding: "utf-8",
    }).trim();
    expect(Number(stdout)).toBe(expected);
  });
});
