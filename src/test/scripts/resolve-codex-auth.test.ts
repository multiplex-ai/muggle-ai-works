import { describe, it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const actionDir = fileURLToPath(new URL("../../../.github/actions/resolve-codex-auth/", import.meta.url));
const actionPath = join(actionDir, "action.yml");
const seedHomePath = join(actionDir, "seed-home.sh");

const SUBSCRIPTION_AUTH_JSON = JSON.stringify({
  auth_mode: "chatgpt",
  OPENAI_API_KEY: null,
  tokens: { id_token: "id", access_token: "access", refresh_token: "refresh", account_id: "acct" },
  last_refresh: "2026-11-15T23:36:04Z",
});

// The resolver lives in the action's `run` block, so it is read back from the
// file rather than duplicated here — a copy would keep passing after the action changed.
function resolveScript(): string {
  const lines = readFileSync(actionPath, "utf8").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === "run: |");
  if (start === -1) throw new Error("resolve run block not found in resolve-codex-auth/action.yml");
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

interface ResolveRun {
  exitCode: number | null;
  stderr: string;
  outputs: string;
  exportedEnv: string;
  runnerTemp: string;
}

function runResolve(secrets: { apiKey?: string; subscriptionAuthJson?: string }): ResolveRun {
  const workDir = mkdtempSync(join(tmpdir(), "resolve-codex-auth-"));
  const githubEnvPath = join(workDir, "github-env");
  const githubOutputPath = join(workDir, "github-output");
  writeFileSync(githubEnvPath, "");
  writeFileSync(githubOutputPath, "");
  const resolve = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", resolveScript()], {
    encoding: "utf8",
    env: {
      ...process.env,
      RUNNER_TEMP: workDir,
      GITHUB_ENV: githubEnvPath,
      GITHUB_OUTPUT: githubOutputPath,
      OPENAI_API_KEY_INPUT: secrets.apiKey ?? "",
      SUBSCRIPTION_AUTH_JSON: secrets.subscriptionAuthJson ?? "",
    },
  });
  return {
    exitCode: resolve.status,
    stderr: resolve.stderr,
    outputs: readFileSync(githubOutputPath, "utf8"),
    exportedEnv: readFileSync(githubEnvPath, "utf8"),
    runnerTemp: workDir,
  };
}

describe.runIf(hasBash)("resolve-codex-auth", () => {
  it("exports an API key as CODEX_API_KEY and prefers it over a subscription login", () => {
    const run = runResolve({ apiKey: "sk-test", subscriptionAuthJson: SUBSCRIPTION_AUTH_JSON });
    expect(run.exitCode).toBe(0);
    expect(run.exportedEnv).toContain("CODEX_API_KEY=sk-test");
    expect(run.exportedEnv).not.toContain("CODEX_AUTH_FILE");
    expect(run.outputs).toContain("method=api-key");
  });

  it("writes a subscription login to a private file and exports its path", () => {
    const run = runResolve({ subscriptionAuthJson: SUBSCRIPTION_AUTH_JSON });
    expect(run.exitCode).toBe(0);
    expect(run.outputs).toContain("ready=true");
    expect(run.outputs).toContain("method=subscription");
    const exportedAuthFile = /^CODEX_AUTH_FILE=(.+)$/m.exec(run.exportedEnv)?.[1];
    expect(exportedAuthFile).toBeDefined();
    expect(JSON.parse(readFileSync(exportedAuthFile as string, "utf8")).tokens.refresh_token).toBe("refresh");
  });

  it("fails loudly on a secret that is not a codex login", () => {
    const run = runResolve({ subscriptionAuthJson: '{"auth_mode":"chatgpt"}' });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("CODEX_AUTH_JSON unusable");
  });

  it("reports not ready with neither secret, so the job skips", () => {
    const run = runResolve({});
    expect(run.exitCode).toBe(0);
    expect(run.outputs).toContain("ready=false");
    expect(run.exportedEnv).toBe("");
  });
});

describe.runIf(hasBash)("resolve-codex-auth seed-home.sh", () => {
  it("copies the login into every Codex home given, owner-only", () => {
    const workDir = mkdtempSync(join(tmpdir(), "seed-codex-home-"));
    const authFile = join(workDir, "codex-auth.json");
    writeFileSync(authFile, SUBSCRIPTION_AUTH_JSON);
    const homes = [join(workDir, "gate-a"), join(workDir, "nested", "gate-b")];
    const seed = spawnSync("bash", [seedHomePath, ...homes], {
      encoding: "utf8",
      env: { ...process.env, CODEX_AUTH_FILE: authFile },
    });
    expect(seed.status).toBe(0);
    for (const home of homes) {
      expect(readFileSync(join(home, "auth.json"), "utf8")).toBe(SUBSCRIPTION_AUTH_JSON);
      if (process.platform !== "win32") expect(statSync(join(home, "auth.json")).mode & 0o777).toBe(0o600);
    }
  });

  it("does nothing under API-key auth", () => {
    const workDir = mkdtempSync(join(tmpdir(), "seed-codex-home-"));
    const env = { ...process.env };
    delete env.CODEX_AUTH_FILE;
    const seed = spawnSync("bash", [seedHomePath, join(workDir, "home")], { encoding: "utf8", env: env });
    expect(seed.status).toBe(0);
    expect(existsSync(join(workDir, "home", "auth.json"))).toBe(false);
  });
});
