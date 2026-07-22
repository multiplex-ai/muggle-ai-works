/**
 * Static lint for plugin/agents/pr-watcher.md.
 *
 * The agent exists to fix a measured regression: the `model:` pin in a skill's
 * frontmatter is inert for anything a cron dispatches, because the tick runs in
 * whatever session the cron enqueued into. An agent definition's pin IS honored,
 * so the pin and the restricted tool list are the load-bearing lines in the file
 * — a future edit that drops either silently reintroduces the bug. These
 * assertions exist to make that edit fail loudly.
 *
 * Prose is the implementation here: these check the definition still says the
 * load-bearing thing; they do NOT catch an agent that ignores it.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const AGENTS_DIR = path.join(REPO_ROOT, "plugin", "agents");
const AGENT_FILE = path.join(AGENTS_DIR, "pr-watcher.md");

function splitFrontmatter(md: string): { frontmatter: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(md);
  if (!match) return { frontmatter: "", body: "" };
  return { frontmatter: match[1], body: match[2] };
}

function field(frontmatter: string, name: string): string {
  const match = new RegExp(`^${name}:\\s*(.+)$`, "m").exec(frontmatter);
  return match ? match[1].trim() : "";
}

const raw = fs.readFileSync(AGENT_FILE, "utf8");
const { frontmatter, body } = splitFrontmatter(raw);

describe("parser sanity: refuse to pass vacuously", () => {
  it("the agent definition parses into frontmatter and a body", () => {
    expect(fs.existsSync(AGENT_FILE)).toBe(true);
    expect(frontmatter.trim().length, "frontmatter block not found").toBeGreaterThan(0);
    expect(body.trim().length, "body not found").toBeGreaterThan(0);
  });
});

describe("pr-watcher frontmatter", () => {
  it("is pinned to haiku — the entire reason the agent exists", () => {
    expect(field(frontmatter, "model")).toBe("haiku");
  });

  it("declares the name the orchestrator dispatches", () => {
    expect(field(frontmatter, "name")).toBe("pr-watcher");
  });

  it("carries a description so the agent is selectable", () => {
    expect(field(frontmatter, "description").length).toBeGreaterThan(40);
  });

  it("grants only Bash, Read, and Write", () => {
    const tools = field(frontmatter, "tools")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .sort();
    expect(tools).toEqual(["Bash", "Read", "Write"]);
  });

  it("has no Edit tool — session JSON must be rewritten whole-file", () => {
    expect(field(frontmatter, "tools")).not.toMatch(/\bEdit\b/);
  });

  it("matches the frontmatter shape of the existing agent convention", () => {
    const sibling = splitFrontmatter(
      fs.readFileSync(path.join(AGENTS_DIR, "acceptance-tester.md"), "utf8"),
    ).frontmatter;
    for (const key of ["name", "description", "model"]) {
      expect(field(sibling, key).length, `convention agent lacks ${key}`).toBeGreaterThan(0);
      expect(field(frontmatter, key).length, `pr-watcher lacks ${key}`).toBeGreaterThan(0);
    }
  });
});

describe("pr-watcher evaluate/execute boundary", () => {
  it("states that it returns a decision and never runs the cycle", () => {
    expect(body).toMatch(/evaluate.{0,20}never execute/i);
    expect(body).toMatch(/cannot fire a slash command/i);
  });

  it("keeps the dispatch with the orchestrator", () => {
    expect(body).toMatch(/orchestrator dispatches/i);
  });

  it("forbids posting to the PR and editing code", () => {
    expect(body).toMatch(/never post to the pr/i);
    expect(body).toMatch(/never edit code/i);
  });

  it("never self-cancels on cost — only a terminal PR or the user stops a watcher", () => {
    expect(body).toMatch(/never decide to stop watching/i);
    expect(body).toMatch(/cost is not your call/i);
  });
});

describe("pr-watcher detection semantics match the watcher contract", () => {
  it("classifies threads by the loop marker, not the author login", () => {
    expect(body).toContain("<!-- muggle-do:bot -->");
    expect(body).toMatch(/never by ['`]?author\.login/i);
  });

  it("requires both isResolved false and isOutdated false", () => {
    expect(body).toMatch(/isResolved == false/);
    expect(body).toMatch(/isOutdated == false/);
  });

  it("gates body-only reviews on the watermark and the escalated set", () => {
    expect(body).toMatch(/id > .?lastBodyReviewId/);
    expect(body).toMatch(/escalated_review_ids/);
  });

  it("keeps the CI budget at 3, keyed on the head SHA", () => {
    expect(body).toMatch(/ci_fix_attempts\[head_sha\] < 3/);
    expect(body).toMatch(/ci_escalated_shas/);
  });

  it("keeps the rebase budget at 2, keyed on head..base_tip", () => {
    expect(body).toMatch(/conflict_resolve_attempts\[key\] < 2/);
    expect(body).toMatch(/<head_sha>\.\.<base_tip_sha>/);
    expect(body).toMatch(/conflict_escalated_keys/);
  });

  it("reads behind-by from commit ancestry, never from mergeStateStatus", () => {
    expect(body).toMatch(/never from .?mergeStateStatus == BEHIND/);
  });

  it("keeps reviews ahead of rebase and CI", () => {
    expect(body).toMatch(/reviews preempt everything below/i);
  });

  it("reports a failed fetch as ERROR rather than inferring IDLE", () => {
    expect(body).toMatch(/never infer .?IDLE.? from a failed fetch/i);
  });

  it("rewrites last_seen.json whole-file", () => {
    expect(body).toMatch(/never.{0,60}partial edit/i);
    expect(body).toMatch(/preserve every field/i);
  });
});

describe("pr-watcher dependency direction", () => {
  it("does not link into the executor's own procedure files", () => {
    const links = [...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    const upward = links.filter((target) => /(^|\/)do\//.test(target));
    expect(upward, `agent links into do/: ${upward.join(", ")}`).toEqual([]);
  });

  it("reuses the shared VCS recipes instead of restating the queries", () => {
    for (const recipe of [
      "pr-metadata.md",
      "unresolved-threads.md",
      "submitted-reviews.md",
      "pr-checks.md",
    ]) {
      expect(body, `does not reference ${recipe}`).toContain(recipe);
    }
  });
});
