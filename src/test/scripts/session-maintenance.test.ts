import { describe, it, expect, vi } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const toBash = (p: string) => p.replace(/\\/g, "/");

const scriptPath = toBash(
  fileURLToPath(new URL("../../../plugin/scripts/session-maintenance.sh", import.meta.url)),
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
// helpers load — the upkeep (state GC, muggle setup, npm view) never runs.
function runBash(snippet: string): { stdout: string; status: number } {
  const dir = mkdtempSync(join(tmpdir(), "session-maintenance-"));
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

const load = 'MUGGLE_SESSION_MAINTENANCE_LIB_ONLY=1 source "$SCRIPT";';

describe.skipIf(!hasBash)("session-maintenance.sh file_mtime", () => {
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
    // A non-numeric mtime in the TTL arithmetic aborted with
    // `File: unbound variable`; file_mtime must always yield a number.
    const { stdout, status } = runBash(
      `set -u; stat() { printf 'File: junk\\n'; return 0; }; ${load} ` +
        `now=$(date +%s); echo $((now - $(file_mtime "$TESTFILE")))`,
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(/^\d+$/);
  });

  it("matches node's view of the file mtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "session-maintenance-"));
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

describe.skipIf(!hasBash)("session-maintenance.sh release_lane_tag", () => {
  it.each([
    ["5.33.0", "latest"],
    ["5.33.0-staging.301", "staging"],
    ["5.40.0-beta.1", "latest"],
  ])("reads the lane of %s as %s", (version, expectedTag) => {
    expect(runBash(`${load} release_lane_tag "${version}"`).stdout).toBe(expectedTag);
  });
});

describe.skipIf(!hasBash)("session-maintenance.sh version_is_newer", () => {
  it.each([
    ["5.33.0", "5.32.0", true],
    ["5.32.0", "5.32.0", false],
    ["5.32.0", "5.33.0", false],
    ["5.10.0", "5.9.0", true],
    ["5.39.0-staging.100", "5.39.0-staging.99", true],
    ["5.39.0-staging.99", "5.39.0-staging.100", false],
    ["5.39.0-staging.360", "5.38.0-staging.359", true],
    ["5.39.0-staging.369", "5.39.0-staging.369", false],
    ["5.40.0", "5.40.0-beta.1", true],
    ["5.40.0-beta.1", "5.40.0", false],
  ])("reads %s as newer than %s: %s", (candidateVersion, installedVersion, isNewer) => {
    const { status } = runBash(`${load} version_is_newer "${candidateVersion}" "${installedVersion}"`);
    expect(status === 0).toBe(isNewer);
  });
});

describe.skipIf(!hasBash)("session-maintenance.sh is_package_version", () => {
  it.each([
    ["5.33.0", true],
    ["5.39.0-staging.369", true],
    ["", false],
    ["npmerrorcodeE500", false],
    ["<html>", false],
  ])("reads %j as a version: %s", (candidateText, isVersion) => {
    const { status } = runBash(`${load} is_package_version '${candidateText}'`);
    expect(status === 0).toBe(isVersion);
  });
});

describe.skipIf(!hasBash)("session-maintenance.sh version lookup", () => {
  interface LookupRun {
    upgradeAvailable: string | undefined;
    npmArguments: string;
  }

  // Stands in for the three programs the lookup reaches, so the run needs no network, no install and no two-second wait.
  function createLookupStubs(installedVersion: string, distTags: Record<string, string>): string {
    const stubDirectory = mkdtempSync(join(tmpdir(), "session-maintenance-stubs-"));
    const tagCases = Object.entries(distTags)
      .map(([tag, version]) => `  dist-tags.${tag}) echo "${version}" ;;`)
      .join("\n");
    const stubs: Record<string, string> = {
      muggle: `echo "${installedVersion}"`,
      npm: `echo "$*" >> "$HOME/npm-arguments"\ncase "$3" in\n${tagCases}\nesac`,
      sleep: "exit 0",
    };
    for (const [program, body] of Object.entries(stubs)) {
      const stubPath = join(stubDirectory, program);
      writeFileSync(stubPath, `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(stubPath, 0o755);
    }
    return stubDirectory;
  }

  function runLookup(
    installedVersion: string,
    distTags: Record<string, string>,
    seedHome?: (cacheDirectory: string, home: string) => void,
  ): LookupRun {
    const home = mkdtempSync(join(tmpdir(), "session-maintenance-home-"));
    const cacheDirectory = join(home, ".cache", "muggle");
    mkdirSync(cacheDirectory, { recursive: true });
    writeFileSync(join(cacheDirectory, "electron-app-checked"), "");
    seedHome?.(cacheDirectory, home);
    execFileSync("bash", [scriptPath], {
      input: "{}",
      env: {
        ...process.env,
        PATH: `${createLookupStubs(installedVersion, distTags)}${delimiter}${process.env.PATH ?? ""}`,
        HOME: home,
        USERPROFILE: home,
      },
    });
    const upgradeFile = join(cacheDirectory, "upgrade-available");
    const npmArgumentsFile = join(home, "npm-arguments");
    return {
      upgradeAvailable: existsSync(upgradeFile) ? readFileSync(upgradeFile, "utf-8") : undefined,
      npmArguments: existsSync(npmArgumentsFile) ? readFileSync(npmArgumentsFile, "utf-8") : "",
    };
  }

  it("records a newer stable release for a stable install", () => {
    const run = runLookup("5.32.0", { latest: "5.33.0", staging: "5.34.0-staging.1" });
    expect(run.upgradeAvailable).toBe("5.32.0|5.33.0");
    expect(run.npmArguments).toContain("dist-tags.latest");
  });

  it("records a newer staging build for a staging install", () => {
    const run = runLookup("5.33.0-staging.301", { latest: "5.32.0", staging: "5.33.0-staging.310" });
    expect(run.upgradeAvailable).toBe("5.33.0-staging.301|5.33.0-staging.310");
    expect(run.npmArguments).toContain("dist-tags.staging");
  });

  it("never measures a staging install against stable", () => {
    const run = runLookup("5.33.0-staging.301", { latest: "5.34.0", staging: "5.33.0-staging.301" });
    expect(run.upgradeAvailable).toBeUndefined();
  });

  it("clears a recorded upgrade once the install is current", () => {
    const run = runLookup("5.33.0", { latest: "5.33.0" }, (cacheDirectory) => {
      writeFileSync(join(cacheDirectory, "upgrade-available"), "5.32.0|5.33.0");
    });
    expect(run.upgradeAvailable).toBeUndefined();
  });

  it("orders staging builds by their build number, not as text", () => {
    const run = runLookup("5.39.0-staging.99", { latest: "5.38.0", staging: "5.39.0-staging.100" });
    expect(run.upgradeAvailable).toBe("5.39.0-staging.99|5.39.0-staging.100");
  });

  it("measures a prerelease that is not a staging build against stable", () => {
    const run = runLookup("5.40.0-beta.1", { latest: "5.40.0", staging: "5.41.0-staging.400" });
    expect(run.upgradeAvailable).toBe("5.40.0-beta.1|5.40.0");
    expect(run.npmArguments).toContain("dist-tags.latest");
  });

  it("stays silent and keeps the recorded upgrade when the registry returns nothing", () => {
    const run = runLookup("5.32.0", {}, (cacheDirectory) => {
      writeFileSync(join(cacheDirectory, "upgrade-available"), "5.32.0|5.33.0");
    });
    expect(run.upgradeAvailable).toBe("5.32.0|5.33.0");
  });

  it("records nothing when the registry answers with something that is not a version", () => {
    const run = runLookup("5.32.0", { latest: "npm error code E500" });
    expect(run.upgradeAvailable).toBeUndefined();
  });

  it("looks the lane up on every run, whatever an earlier build cached", () => {
    const run = runLookup("5.32.0", { latest: "5.33.0" }, (cacheDirectory) => {
      writeFileSync(join(cacheDirectory, "version-check"), "5.32.0|5.32.0");
    });
    expect(run.upgradeAvailable).toBe("5.32.0|5.33.0");
  });

  it("makes no lookup and clears the notice under checkForUpdates=never", () => {
    const run = runLookup("5.32.0", { latest: "5.33.0" }, (cacheDirectory, home) => {
      writeFileSync(join(cacheDirectory, "upgrade-available"), "5.32.0|5.33.0");
      mkdirSync(join(home, ".muggle-ai"), { recursive: true });
      writeFileSync(
        join(home, ".muggle-ai", "preferences.json"),
        JSON.stringify({ preferences: { checkForUpdates: "never" } }, null, 2),
      );
    });
    expect(run.npmArguments).toBe("");
    expect(run.upgradeAvailable).toBeUndefined();
  });
});

describe.skipIf(!hasBash)("session-maintenance.sh version lookup beside a stuck upkeep step", () => {
  const STUCK_SETUP_MS = 20_000;
  const NOTICE_TIMEOUT_MS = 12_000;
  const NOTICE_POLL_MS = 100;

  // `muggle setup` never returns, as an Electron install blocked by the host does, and `timeout` hands its command
  // straight through, as on a machine that ships none, so nothing ends the step.
  function createStuckSetupStubs(installedVersion: string, newestVersion: string): string {
    const stubDirectory = mkdtempSync(join(tmpdir(), "session-maintenance-stuck-"));
    const stubs: Record<string, string> = {
      muggle: `if [ "$1" = "setup" ]; then node -e "setTimeout(() => {}, ${STUCK_SETUP_MS})"; else echo "${installedVersion}"; fi`,
      npm: `echo "${newestVersion}"`,
      sleep: "exit 0",
      timeout: 'shift 3\nexec "$@"',
    };
    for (const [program, body] of Object.entries(stubs)) {
      const stubPath = join(stubDirectory, program);
      writeFileSync(stubPath, `#!/usr/bin/env bash\n${body}\n`);
      chmodSync(stubPath, 0o755);
    }
    return stubDirectory;
  }

  it("records a newer lane version while the Electron step never finishes", async () => {
    const home = mkdtempSync(join(tmpdir(), "session-maintenance-home-"));
    const upgradeFile = join(home, ".cache", "muggle", "upgrade-available");
    const upkeep = spawn("bash", [scriptPath], {
      stdio: ["pipe", "ignore", "ignore"],
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${createStuckSetupStubs("5.39.0-staging.361", "5.39.0-staging.369")}${delimiter}${process.env.PATH ?? ""}`,
        HOME: home,
        USERPROFILE: home,
      },
    });
    upkeep.stdin.end("{}");
    try {
      await vi.waitFor(() => expect(existsSync(upgradeFile)).toBe(true), {
        timeout: NOTICE_TIMEOUT_MS,
        interval: NOTICE_POLL_MS,
      });
      expect(readFileSync(upgradeFile, "utf-8")).toBe("5.39.0-staging.361|5.39.0-staging.369");
    } finally {
      upkeep.kill();
    }
  }, 30_000);
});
