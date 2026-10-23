import { describe, it, expect, beforeEach, vi } from "vitest";
import { execFileSync, spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath, pathToFileURL } from "url";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, dirname, join } from "path";
import { renderE2eResultMarker } from "../../e2e-result/marker";
import { WALKTHROUGH_SKIPPED_MARKER } from "../../pr-walkthrough/constants";

// The NO_APP_LOGIC_CHANGE skip end to end through the real hook entry: the
// verifier runs git against a real repository, and an accepted declaration
// hands the PR's walkthrough comment to a detached settle job.
const CLI = fileURLToPath(new URL("../../guardrails/cli.ts", import.meta.url));

interface CycleRepo {
  repo: string;
  preCycleSha: string;
  commit: (relativePath: string, content: string) => void;
}

// HOME points at a throwaway directory so a contributor's global git config —
// signing above all — never reaches the fixture's commits.
function cycleRepo(home: string): CycleRepo {
  const repo = mkdtempSync(join(tmpdir(), "nalc-repo-"));
  const git = (...args: string[]): string =>
    execFileSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    });
  const commit = (relativePath: string, content: string): void => {
    mkdirSync(dirname(join(repo, relativePath)), { recursive: true });
    writeFileSync(join(repo, relativePath), content);
    git("add", "-A");
    git("commit", "-q", "-m", relativePath);
  };
  git("init", "-q");
  commit("src/app.ts", "export const total = 1;\n");
  return { repo: repo, preCycleSha: git("rev-parse", "HEAD").trim(), commit: commit };
}

const declaration = (preCycleSha: string): string =>
  `echo "MUGGLE_E2E_SKIP: NO_APP_LOGIC_CHANGE: ${preCycleSha.slice(0, 7)} README typo"`;

const MAX_DECLARATION_ATTEMPTS = 3;

// The verifier's git call must finish inside the hook's 600ms child-process
// deadline, and an overrun refutes the declaration (fail closed, nothing
// recorded). That is why this file runs alone (WALL_CLOCK_HOOK_TESTS in
// vitest.config.ts); the bounded retry absorbs a slow runner's occasional
// overrun so the tests stay about the verdict.
function retryDeclaration(declare: () => string, isVerdict: (reply: string) => boolean): string {
  let reply = declare();
  for (let attempt = 1; attempt < MAX_DECLARATION_ATTEMPTS && !isVerdict(reply); attempt++) reply = declare();
  return reply;
}

describe("NO_APP_LOGIC_CHANGE through the record-tests hook", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "nalc-home-"));
  });

  function runHook(sub: string, payload: unknown): string {
    const result = spawnSync(process.execPath, ["--import", "tsx", CLI, sub], {
      input: JSON.stringify(payload),
      encoding: "utf-8",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    return (result.stdout ?? "").trim();
  }

  const recordBash = (session: string, command: string, cwd?: string): string =>
    runHook("record-tests", {
      session_id: session,
      tool_name: "Bash",
      tool_input: { command: command },
      tool_response: { stdout: command.includes("pnpm test") ? "Tests: 4 passed" : "" },
      cwd: cwd,
    });

  const gateBlocks = (session: string): boolean => runHook("e2e-gate", { session_id: session }) !== "{}";

  const declareUntil = (session: string, cycle: CycleRepo, isVerdict: (reply: string) => boolean): string =>
    retryDeclaration(() => recordBash(session, declaration(cycle.preCycleSha), cycle.repo), isVerdict);

  it("releases the E2E gate for a docs-only cycle, and the next green round owes E2E again", () => {
    const session = "nalc-accept";
    const cycle = cycleRepo(home);
    cycle.commit("README.md", "# docs\n");
    recordBash(session, "pnpm test");
    expect(gateBlocks(session)).toBe(true);

    expect(declareUntil(session, cycle, (reply) => reply === "{}")).toBe("{}");
    expect(gateBlocks(session)).toBe(false);

    recordBash(session, "pnpm test");
    expect(gateBlocks(session)).toBe(true);
  });

  it("answers a cycle that touched source with the paths that refute it, leaving the gate armed", () => {
    const session = "nalc-reject";
    const cycle = cycleRepo(home);
    cycle.commit("README.md", "# docs\n");
    cycle.commit("src/app.ts", "// only a comment\nexport const total = 1;\n");
    recordBash(session, "pnpm test");

    const rejected = declareUntil(session, cycle, (reply) => reply.includes("app-logic paths changed"));
    expect(rejected).toContain("NO_APP_LOGIC_CHANGE");
    expect(rejected).toContain("src/app.ts");
    expect(gateBlocks(session)).toBe(true);
  });
});

// The settle runs detached and talks to the provider, so it is exercised
// against a stubbed `gh`. Bash-only, so skipped on win32 (covered by the
// Linux/macOS platform-compat jobs).
describe.skipIf(process.platform === "win32")("NO_APP_LOGIC_CHANGE settles the walkthrough comment", () => {
  const PR_URL = "https://github.com/o/r/pull/5";
  const NEW_HEAD = "9f8e7d6c5b4a39281706f5e4d3c2b1a098f7e6d5";
  // The detached job inherits the hook's loader flag and runs in the fixture
  // repo, where a bare `tsx` specifier does not resolve — so it gets a URL.
  const TSX_LOADER = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  const LAST_RUN =
    "<!-- muggle-pr-section:v1 -->\n" +
    `${renderE2eResultMarker({ total: 2, passed: 2, unpassed: [] })}\n` +
    "## E2E Acceptance Results\n\n**✅ PASS** — 2 tests ran";

  it("rewrites the PR's posted walkthrough as skipped for the new head, carrying the last run", async () => {
    const home = mkdtempSync(join(tmpdir(), "nalc-home-"));
    const binDir = mkdtempSync(join(tmpdir(), "nalc-gh-"));
    const patchLog = join(binDir, "patch.json");
    // A PATCH is checked before the listing because its path also ends in a
    // comments segment; the write lands whole so the poll never reads half a body.
    writeFileSync(
      join(binDir, "gh"),
      [
        "#!/usr/bin/env bash",
        'args="$*"',
        'case "$args" in',
        '  "pr view"*) printf \'%s\' "$STUB_PR_URL" ;;',
        '  *"--method PATCH"*) cat > "$STUB_PATCH_LOG.tmp" && mv "$STUB_PATCH_LOG.tmp" "$STUB_PATCH_LOG"; printf \'{}\' ;;',
        '  *"/pulls/"*) printf \'%s\' "$STUB_HEAD_SHA" ;;',
        '  *"/comments"*) printf \'%s\' "$STUB_COMMENTS" ;;',
        "esac",
        "",
      ].join("\n"),
    );
    chmodSync(join(binDir, "gh"), 0o755);

    const cycle = cycleRepo(home);
    cycle.commit("README.md", "# docs\n");
    const declare = (): string =>
      (
        spawnSync(process.execPath, ["--import", TSX_LOADER, CLI, "record-tests"], {
          input: JSON.stringify({
            session_id: "nalc-settle",
            tool_name: "Bash",
            tool_input: { command: declaration(cycle.preCycleSha) },
            tool_response: { stdout: "" },
            cwd: cycle.repo,
          }),
          encoding: "utf-8",
          env: {
            ...process.env,
            PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
            HOME: home,
            USERPROFILE: home,
            MUGGLE_GUARDRAIL_GH_CALLS: "",
            STUB_PR_URL: PR_URL,
            STUB_HEAD_SHA: NEW_HEAD,
            STUB_PATCH_LOG: patchLog,
            STUB_COMMENTS: JSON.stringify([
              { id: 10, body: "looks good" },
              { id: 11, body: LAST_RUN },
            ]),
          },
        }).stdout ?? ""
      ).trim();
    retryDeclaration(declare, (reply) => reply === "{}");

    await vi.waitFor(() => expect(existsSync(patchLog)).toBe(true), { timeout: 30_000, interval: 200 });
    const body = (JSON.parse(readFileSync(patchLog, "utf-8")) as { body: string }).body;
    expect(body).toContain(WALKTHROUGH_SKIPPED_MARKER);
    expect(body).toContain("no app-logic change in `9f8e7d6`");
    expect(body).toContain("README typo");
    expect(body).toContain("**✅ PASS** — 2 tests ran");
    expect(body).toContain("muggle-e2e-result:v1");
    expect(body).not.toContain("muggle-pr-section");
  });
});
