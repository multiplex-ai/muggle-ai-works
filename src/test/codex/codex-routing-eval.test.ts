import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { join } from "path";
import { CODEX_BIN, CodexSession, REPO_ROOT, runToCompletion } from "./support/codexSession.js";
import { MockResponsesServer, assistantMessage, messageTexts, shellCall } from "./support/mockResponsesServer.js";
import type { ModelRequest, ProcessResult, ScriptedTurn } from "./support/types.js";

// The routing eval's Codex harness (internal/skill-routing-eval, `--host codex`)
// against the real Codex CLI and a scripted model. The eval's own `prepare`
// installs the plugin and the route tracer, and `router_eval.py --probe` reads
// the route the way the sweep does. The scripted model opens skills the way a
// real one must — expanding the short paths in the catalog through the skill
// roots Codex lists — so a change in how Codex lists, opens or reports skills
// fails here, instead of reading as a routing regression in the nightly sweep.
//
// Runs with the rest of the live suite (CODEX_BIN set), and needs Python 3.10+.

const EVAL_DIR = join(REPO_ROOT, "internal", "skill-routing-eval");
const PYTHON = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const HAS_PYTHON = spawnSync(PYTHON, ["--version"], { encoding: "utf-8" }).status === 0;
const WINDOWS = process.platform === "win32";
const LIVE_TIMEOUT_MS = 180_000;
const PROBE_QUERY = "run a muggle E2E acceptance test on my web app";

/** The installed plugin's skills directory, from the skill roots table Codex hands the model. */
function pluginSkillsRoot(request: ModelRequest): string {
  const catalog = messageTexts(request, "developer").find((text) => text.includes("### Skill roots")) ?? "";
  const root = [...catalog.matchAll(/^- `r\d+` = `([^`]+)`$/gm)]
    .map(([, path]) => path)
    .find((path) => /muggle-works[\\/]muggle[\\/]/.test(path));
  if (!root) throw new Error(`no muggle skill root in the catalog Codex sent:\n${catalog.slice(0, 2000)}`);
  return root;
}

/** The command a model reads a skill with, a page at a time as Codex models do. */
function readSkillCommand(request: ModelRequest, skill: string): string {
  const root = pluginSkillsRoot(request);
  return WINDOWS
    ? `Get-Content -TotalCount 200 -LiteralPath '${root}\\${skill}\\SKILL.md'`
    : `sed -n '1,200p' '${root}/${skill}/SKILL.md'`;
}

it.runIf(process.env.MUGGLE_REQUIRE_CODEX_LIVE === "1")("has a Python to run the routing eval's harness with", () => {
  expect(HAS_PYTHON, `${PYTHON} --version failed; set PYTHON to a Python 3.10+`).toBe(true);
});

describe.skipIf(!CODEX_BIN || !HAS_PYTHON)("the routing eval's Codex harness in a real Codex", () => {
  const model = new MockResponsesServer();
  const session = new CodexSession(model);

  /** One `router_eval.py --probe` against the scripted model; stdout is the bare route. */
  async function probe(script: ScriptedTurn): Promise<ProcessResult> {
    model.useScript(script);
    return runToCompletion(
      PYTHON,
      [join(EVAL_DIR, "router_eval.py"), "--host", "codex", "--probe", PROBE_QUERY, "--repo-root", session.workspace, "--timeout", "120"],
      // A runner without user namespaces cannot start Codex's sandbox; the probe's commands only read.
      { cwd: EVAL_DIR, env: { ...session.env(), MUGGLE_CODEX_SANDBOX: "danger-full-access" } },
    );
  }

  beforeAll(async () => {
    await model.start();
    session.prepare(() => {
      const prepare = spawnSync(PYTHON, [join(EVAL_DIR, "codex_session.py"), "prepare", "--codex-home", session.codexHome], {
        cwd: EVAL_DIR,
        env: session.env(),
        encoding: "utf-8",
      });
      if (prepare.status !== 0) throw new Error(`codex_session.py prepare exited ${prepare.status}\n${prepare.stdout}\n${prepare.stderr}`);
    });
  }, LIVE_TIMEOUT_MS);

  afterAll(async () => {
    await model.stop();
  });

  it("reads the route off the skill the session opens, after it has looked around", async () => {
    const run = await probe((request, index) => {
      if (index === 0) return shellCall("look", "git status --short");
      if (index === 1) return shellCall("open", readSkillCommand(request, "muggle-test"));
      return assistantMessage("Following the muggle-test skill.");
    });
    expect(run.stdout.trim(), run.stderr).toBe("muggle-test");
  }, LIVE_TIMEOUT_MS);

  // Without the cap the scripted model would look forever, and the probe would
  // print TIMEOUT after two minutes instead of a classified `none`.
  it("ends a session that never routes once it has looked as long as a Claude session may", async () => {
    const run = await probe((_request, index) => shellCall(`look-${index}`, "git status --short"));
    expect(run.stdout.trim(), run.stderr).toBe("none");
    expect(run.stderr).toContain("no route: oriented_only");
  }, LIVE_TIMEOUT_MS);

  it("explains a session that answered instead of routing", async () => {
    const run = await probe(() => assistantMessage("Muggle cannot help with that."));
    expect(run.stdout.trim(), run.stderr).toBe("none");
    expect(run.stderr).toContain("no route: no_tool_call");
    expect(run.stderr).toContain("it answered instead: Muggle cannot help with that.");
  }, LIVE_TIMEOUT_MS);
});
