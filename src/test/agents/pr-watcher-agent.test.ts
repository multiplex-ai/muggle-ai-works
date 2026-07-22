/**
 * Static lint for plugin/agents/pr-watcher.md.
 *
 * A skill's own `model:` frontmatter is inert for anything a cron dispatches, so
 * the agent definition is the only place the pin holds — dropping it silently
 * restores the bug. The duplication guard is the other half: the poller is
 * deliberately dumb, and restating muggle-pr-followup's decision rules here is
 * what a reviewer already rejected once.
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
  // `tools`, not as a command in the body. This replaced a `tools: Bash` pin.
  it("pins no OS-specific shell", () => {
    const shellSpecific = /\b(bash|zsh|sh -c|powershell|pwsh|cmd\.exe)\b/i;
    expect(field("tools")).not.toMatch(shellSpecific);
    expect(body).not.toMatch(shellSpecific);
  });

  // Weaker than the old `tools` restriction, which made reading the file
  // impossible. Without a tool pin the prohibition is prose, so assert the prose.
  it("still forbids taking the baseline from session state", () => {
    expect(body).toMatch(/never read it from `last_seen\.json`/i);
  });

  // Matched on substance, not phrasing — an earlier version pinned the exact
  // wording and broke on a pure copy-edit that kept both rules.
  it("keeps the detect-never-execute and never-stop-watching rules", () => {
    expect(body).toMatch(/detect, never execute/i);
    expect(body).toMatch(/never .{0,20}stop watching/i);
    expect(body).toMatch(/only a terminal pr or the user/i);
  });

  it("restates none of muggle-pr-followup's decision rules", () => {
    const owned = ["isResolved", "isOutdated", "muggle-do:bot", "ci_fix_attempts",
      "ci_escalated_shas", "conflict_resolve_attempts", "conflict_escalated_keys",
      "escalated_review_ids", "behind_by", "mergeStateStatus"];
    expect(owned.filter((rule) => body.includes(rule))).toEqual([]);
  });

  it("does not link into the executor's own procedure files", () => {
    const links = [...body.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
    expect(links.filter((target) => /(^|\/)do\//.test(target))).toEqual([]);
  });
});
