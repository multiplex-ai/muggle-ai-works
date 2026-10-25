/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins that local E2E always runs code built on the latest base. Sessions used to
 * create worktrees from whatever HEAD they stood on, replay prepare recipes that
 * started services from stale or foreign checkouts, reuse any listener on a port,
 * and share one PID tracker that let a session tear down a peer's servers. Each
 * assertion below closes one of those paths; the execute tools' refusal is the
 * code-level backstop, pinned in packages/mcps.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { sectionBody } from "./helpers/markdown-sections";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugin");
const SKILLS_DIR = path.join(PLUGIN_DIR, "skills");
const SHARED_DIR = path.join(SKILLS_DIR, "_shared");
const PREPARE_DIR = path.join(SKILLS_DIR, "muggle-test-prepare");
const PREPARE_STEPS_DIR = path.join(PREPARE_DIR, "steps");

const read = (...segments: string[]): string => fs.readFileSync(path.join(...segments), "utf8");

/** Every markdown file under a directory, recursively. */
function listMarkdown(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listMarkdown(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

describe("worktree creation", () => {
  const startWork = sectionBody(read(SHARED_DIR, "use-worktrees.md"), /^## Start new change work$/m);

  it("creates every branch from the fetched remote base, never from HEAD", () => {
    expect(startWork).toMatch(/fetch --no-tags origin/);
    expect(startWork).toMatch(/worktree add <main-root>\/\.claude\/worktrees\/<sanitized-branch> -b <branch> origin\/<base>/);
    expect(startWork).not.toMatch(/worktree add [^\n]*-b <branch>\s*$/m);
  });

  it("confirms the new worktree with the freshness check", () => {
    expect(startWork).toMatch(/muggle checkout-freshness/);
  });
});

describe("base sync", () => {
  const syncDoc = read(SHARED_DIR, "sync-branch-with-base.md");
  const beforeRun = sectionBody(syncDoc, /^## Before a dev server or E2E run$/m);

  it("takes its verdict from the freshness CLI", () => {
    expect(syncDoc).toMatch(/muggle checkout-freshness --base "\$\{base\}" --json/);
    for (const verdict of ["FRESH", "NOT_APPLICABLE", "BEHIND_BASE", "FOREIGN_BASE"]) {
      expect(syncDoc).toContain(`\`${verdict}\``);
    }
  });

  it("stops instead of running stale code when the rebase is declined", () => {
    expect(beforeRun).toMatch(/`never` → stop the run/);
    expect(beforeRun).toMatch(/`Don't rebase` stops the run/);
    expect(beforeRun).toMatch(/There is no run-as-is/);
  });

  it("stops on a foreign base whatever autoRebase says", () => {
    expect(sectionBody(syncDoc, /^## Foreign base$/m)).toMatch(/stops the run or push whatever `autoRebase` says/);
  });

  it("offers no run-as-is option in the autoRebase picker", () => {
    const gate = read(SKILLS_DIR, "muggle-preferences", "preference-gates", "autoRebase.md");
    expect(gate).not.toMatch(/as-is` —/);
    expect(gate).toMatch(/stops instead of testing stale code/);
  });
});

describe("PR-branch worktrees", () => {
  it("sync onto the PR's base locally and never push that rebase", () => {
    const doc = read(SHARED_DIR, "pr-branch-worktree.md");
    expect(doc).toMatch(/headRefName,baseRefName/);
    expect(doc).toMatch(/Bring it onto the latest base/);
    expect(doc).toMatch(/\*\*never push it\*\*/);
  });
});

describe("muggle-test-prepare", () => {
  it("syncs and re-resolves sources on replays, not only on learning runs", () => {
    const replay = read(PREPARE_STEPS_DIR, "replay-or-learn.md");
    const recipeExists = replay.split("\n").find((line) => line.startsWith("- **Recipe exists**")) ?? "";
    expect(recipeExists).toMatch(/\[rebase-check\]/);
    expect(recipeExists).toMatch(/\[resolve-sources\]/);
    expect(read(PREPARE_STEPS_DIR, "rebase-check.md")).toMatch(/every invocation — learning runs and replays alike/);
  });

  it("runs sibling services from a base checkout on the latest default branch", () => {
    const sources = read(PREPARE_STEPS_DIR, "resolve-sources.md");
    expect(sources).toMatch(/<main-root>\/\.claude\/worktrees\/base-<default>/);
    expect(sources).toMatch(/checkout --detach --force origin\/<default>/);
    expect(sources).toMatch(/local-execution\.lock/);
  });

  it("saves services by repo, never by checkout", () => {
    const savePlan = sectionBody(read(PREPARE_STEPS_DIR, "readiness-report.md"), /^## Save the plan$/m);
    expect(savePlan).toMatch(/names its \*\*repo\*\*, never a checkout/);
  });

  it("never reuses or kills a listener it cannot tie to this run's checkout", () => {
    const checkRunning = read(PREPARE_STEPS_DIR, "check-running.md");
    expect(checkRunning).toMatch(/\*\*A peer's\*\* — never test against it, never kill it/);
    expect(checkRunning).toMatch(/`headSha` = the commit it must serve/);
  });

  it("reports the source and commit of every service", () => {
    expect(read(PREPARE_STEPS_DIR, "readiness-report.md")).toMatch(/Source\s+Commit\s+Smoke Test/);
  });

  it("cleans up only the caller's own checkout", () => {
    const cleanup = sectionBody(read(PREPARE_DIR, "SKILL.md"), /^## Cleanup$/m);
    expect(cleanup).toMatch(/stops only what runs from the caller's own checkout/);
  });
});

describe("the shared PID tracker is gone", () => {
  it("has no plugin file referencing the machine-wide tracker or its logs", () => {
    const offenders = listMarkdown(PLUGIN_DIR).filter((file) => {
      const doc = fs.readFileSync(file, "utf8");
      return doc.includes("/tmp/muggle-test-prepare.json") || doc.includes("/tmp/muggle-prepare-");
    });
    expect(offenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });
});

describe("callers", () => {
  it("muggle-test-feature-local never skips prepare because PIDs look alive", () => {
    const step = sectionBody(read(SKILLS_DIR, "muggle-test-feature-local", "SKILL.md"), /^### 3\. Ensure Local Services Are Ready$/m);
    expect(step).toMatch(/every run, even when services look up/);
  });

  it("the dev loop treats a refused run as a sync, not a failure", () => {
    const run = read(SHARED_DIR, "dev-loop", "run.md");
    expect(run).toMatch(/\*\*A refused run is not a failure\.\*\*/);
    expect(run).toMatch(/Never route it through failure handling/);
  });

  it("muggle-do's readiness step checks the served source", () => {
    const readinessStep = sectionBody(read(SKILLS_DIR, "do", "e2e-acceptance.md"), /^### Step 0\.5\b.*$/m);
    expect(readinessStep).toMatch(/cycle's worktree as the `Source`/);
  });
});
