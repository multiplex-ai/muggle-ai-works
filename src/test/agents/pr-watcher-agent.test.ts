/**
 * Static lint for plugin/agents/pr-watcher.md.
 *
 * A skill's own `model:` frontmatter is inert for anything dispatched outside
 * the skill turn, so the agent definition is the only place the haiku pin
 * holds. The other assertions keep the poller dumb: detection semantics live
 * in muggle-pr-followup, and the poller may only change-detect against the
 * two comment sources the tick acts on.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "plugin/agents/pr-watcher.md",
);
const [, frontmatter = "", body = ""] =
  /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(fs.readFileSync(AGENT_FILE, "utf8")) ?? [];

const field = (name: string) =>
  (new RegExp(`^${name}:\\s*(.+)$`, "m").exec(frontmatter)?.[1] ?? "").trim();

describe("pr-watcher agent definition", () => {
  it("is pinned to haiku — the entire reason the agent exists", () => {
    expect(field("model")).toBe("haiku");
  });

  // Skills must run on any host, so the definition may not name a shell — not in
  // `tools`, not as a command in the body.
  it("pins no OS-specific shell", () => {
    const shellSpecific = /\b(bash|zsh|sh -c|powershell|pwsh|cmd\.exe)\b/i;
    expect(field("tools")).not.toMatch(shellSpecific);
    expect(body).not.toMatch(shellSpecific);
  });

  // The tick acts on thread state AND submitted reviews; a poller watching only
  // one source silently misses the other (thread replies, or body-only reviews).
  it("baselines both comment sources", () => {
    expect(body).toContain("submitted-reviews.md");
    expect(body).toContain("unresolved-threads.md");
  });

  // Matched on substance, not phrasing — an earlier version pinned exact
  // wording and broke on a pure copy-edit that kept both rules.
  it("keeps the detect-never-execute and never-stop-watching rules", () => {
    expect(body).toMatch(/detect, never execute/i);
    expect(body).toMatch(/never .{0,20}stop watching/i);
    expect(body).toMatch(/only a terminal pr or the user/i);
  });

  // One watcher per PR for its whole life: reporting pauses it, the
  // orchestrator resumes it — it is never respawned per cycle.
  it("pauses on report and resumes on the orchestrator's message", () => {
    expect(body).toMatch(/pause/i);
    expect(body).toMatch(/resume/i);
  });

  it("restates none of muggle-pr-followup's decision rules or state fields", () => {
    const owned = ["isResolved", "isOutdated", "muggle-do:bot", "ci_fix_attempts",
      "ci_escalated_shas", "conflict_resolve_attempts", "conflict_escalated_keys",
      "escalated_review_ids", "behind_by", "mergeStateStatus",
      "lastBodyReviewId", "last_seen"];
    expect(owned.filter((rule) => body.includes(rule))).toEqual([]);
  });

  it("does not link into the executor's own procedure files", () => {
    const links = [...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    expect(links.filter((target) => /(^|\/)do\//.test(target))).toEqual([]);
  });
});

describe("skill ↔ agent arming wiring", () => {
  const SKILLS = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../..",
    "plugin/skills",
  );
  const read = (rel: string) => fs.readFileSync(path.join(SKILLS, rel), "utf8");
  const armWatcher = read("muggle-pr-followup/arm-watcher.md");

  it("arm-watcher spawns this agent and names it after the PR", () => {
    expect(armWatcher).toMatch(/agents\/pr-watcher\.md/);
    expect(armWatcher).toContain("PR #<n> — <title>");
  });

  // Drain-then-watch: the poller baselines at wake, so anything not drained
  // first is silently swallowed by the fresh baseline.
  it("drains before it watches — the tick precedes the spawn", () => {
    expect(armWatcher.indexOf("contract.md")).toBeGreaterThan(-1);
    expect(armWatcher.indexOf("contract.md")).toBeLessThan(
      armWatcher.indexOf("agents/pr-watcher.md"),
    );
  });

  it("every arming point routes through arm-watcher.md", () => {
    for (const rel of [
      "muggle-pr-followup/bootstrap.md",
      "muggle-pr-followup/auto-track.md",
      "do/respawn-watcher.md",
    ]) {
      expect(read(rel), `${rel} does not arm via arm-watcher.md`).toMatch(
        /arm-watcher\.md/,
      );
    }
  });
});
