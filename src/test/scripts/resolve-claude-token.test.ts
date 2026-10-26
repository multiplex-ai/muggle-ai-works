import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const actionPath = fileURLToPath(
  new URL("../../../.github/actions/resolve-claude-token/action.yml", import.meta.url),
);

// What the CLI prints for each kind of token, keyed by the token value the stub receives.
const STUB_CLAUDE = `#!/usr/bin/env bash
case "$CLAUDE_CODE_OAUTH_TOKEN" in
  working) echo "OK" ;;
  weekly) echo "You've hit your weekly limit · resets Oct 27, 12am (UTC)"; exit 1 ;;
  session) echo "You've hit your session limit · resets 9:10pm (UTC)"; exit 1 ;;
  *) echo "Invalid API key · Please run /login"; exit 1 ;;
esac
`;

// The probe lives in the action's `run` block, so it is read back from the file
// rather than duplicated here — a copy would keep passing after the action changed.
function probeScript(): string {
  const lines = readFileSync(actionPath, "utf8").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === "run: |");
  if (start === -1) throw new Error("probe run block not found in resolve-claude-token/action.yml");
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && !line.startsWith("        ")) break;
    body.push(line.slice(8));
  }
  return body.join("\n");
}

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

interface ProbeRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  exportedEnv: string;
}

function runProbe(tokens: { primary: string; fallback?: string; third?: string; fourth?: string }): ProbeRun {
  const workDir = mkdtempSync(join(tmpdir(), "resolve-claude-token-"));
  const stubPath = join(workDir, "claude");
  writeFileSync(stubPath, STUB_CLAUDE);
  chmodSync(stubPath, 0o755);
  const githubEnvPath = join(workDir, "github-env");
  writeFileSync(githubEnvPath, "");
  const probe = spawnSync("bash", ["-c", probeScript()], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${workDir}${delimiter}${process.env.PATH ?? ""}`,
      CLAUDE_CONFIG_DIR: join(workDir, "claude-config"),
      GITHUB_OUTPUT: join(workDir, "github-output"),
      GITHUB_ENV: githubEnvPath,
      PRIMARY_TOKEN: tokens.primary,
      FALLBACK_TOKEN: tokens.fallback ?? "",
      THIRD_TOKEN: tokens.third ?? "",
      FOURTH_TOKEN: tokens.fourth ?? "",
    },
  });
  return {
    exitCode: probe.status,
    stdout: probe.stdout,
    stderr: probe.stderr,
    exportedEnv: readFileSync(githubEnvPath, "utf8"),
  };
}

describe.runIf(hasBash)("resolve-claude-token probe", () => {
  it("falls back past a spent limit and reports it as out of quota, not as needing regeneration", () => {
    const probe = runProbe({ primary: "weekly", fallback: "working" });
    expect(probe.exitCode).toBe(0);
    expect(probe.exportedEnv).toContain("CLAUDE_CODE_OAUTH_TOKEN=working");
    expect(probe.stdout).toContain("Out of usage quota: CLAUDE_CODE_OAUTH_TOKEN (hit your weekly limit · resets Oct 27, 12am (UTC))");
    expect(probe.stdout).not.toContain("rejected; fell back");
  });

  it("tells a run with every token throttled to wait for the reset, not to regenerate", () => {
    const probe = runProbe({ primary: "weekly", fallback: "session" });
    expect(probe.exitCode).toBe(1);
    expect(probe.stderr).toContain("Every configured Claude token is out of usage quota");
    expect(probe.stderr).toContain("CLAUDE_CODE_OAUTH_TOKEN_2 (hit your session limit · resets 9:10pm (UTC))");
    expect(probe.stderr).toContain("Nothing needs regenerating");
  });

  it("still tells a genuinely rejected token to be regenerated", () => {
    const probe = runProbe({ primary: "invalid", fallback: "working" });
    expect(probe.exitCode).toBe(0);
    expect(probe.stdout).toContain("CLAUDE_CODE_OAUTH_TOKEN rejected; fell back to CLAUDE_CODE_OAUTH_TOKEN_2");
    expect(probe.stdout).not.toContain("Out of usage quota");
  });

  it("names both kinds when a rejected token and a throttled one leave nothing to run on", () => {
    const probe = runProbe({ primary: "invalid", fallback: "weekly" });
    expect(probe.exitCode).toBe(1);
    expect(probe.stderr).toContain("Rejected: CLAUDE_CODE_OAUTH_TOKEN — regenerate");
    expect(probe.stderr).toContain("Out of quota, back at their reset: CLAUDE_CODE_OAUTH_TOKEN_2 (hit your weekly limit");
  });

  it("reaches the fourth token once the first three are spent", () => {
    const probe = runProbe({ primary: "weekly", fallback: "weekly", third: "session", fourth: "working" });
    expect(probe.exitCode).toBe(0);
    expect(probe.stdout).toContain("auth ok on CLAUDE_CODE_OAUTH_TOKEN_4");
    expect(probe.exportedEnv).toContain("CLAUDE_CODE_OAUTH_TOKEN=working");
  });
});
