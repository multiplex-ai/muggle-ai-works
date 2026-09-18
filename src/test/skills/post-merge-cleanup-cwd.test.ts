/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins the two rules that keep post-merge teardown from stalling.
 *
 * Observed in the field with `autoCleanup = always`: teardown started from
 * inside the worktree it was about to remove. `git worktree remove` refuses to
 * remove the tree the command stands in, so the agent reported that it was in
 * the directory and waited for the user — a sequence the gate had already
 * pre-authorized, hanging on a prompt nobody was watching. Two defects, pinned
 * separately below:
 *
 *   1. The procedure never told the agent to leave the worktree first, so the
 *      blocker existed at all.
 *   2. Nothing said a blocked step is reported rather than handed back, so the
 *      blocker became a question instead of a report row.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS = path.join(REPO_ROOT, "plugin", "skills");
const CLEANUP_DOC = path.join(SKILLS, "_shared", "post-merge-cleanup.md");
const WORKTREES_DOC = path.join(SKILLS, "_shared", "use-worktrees.md");
const DO_CLEANUP_DOC = path.join(SKILLS, "do", "cleanup.md");

const read = (file: string): string => fs.readFileSync(file, "utf8");

/** Body of a `## <n>. <title>` section, up to the next `## ` heading. */
const sectionBody = (doc: string, heading: RegExp): string => {
  const lines = doc.split("\n");
  const start = lines.findIndex((line) => heading.test(line));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
};

describe("post-merge cleanup leaves the worktree before removing it", () => {
  it("has a leave-the-worktree step, and it comes before the removal", () => {
    const doc = read(CLEANUP_DOC);
    const leaveAt = doc.search(/^## \d+\. Leave the worktree/m);
    const removeAt = doc.search(/^## \d+\. Remove the worktree/m);
    expect(leaveAt, "no `## N. Leave the worktree` step").toBeGreaterThanOrEqual(0);
    expect(removeAt).toBeGreaterThanOrEqual(0);
    expect(leaveAt, "relocation must precede removal").toBeLessThan(removeAt);
  });

  it("names the two failures that make an occupied worktree look unfixable", () => {
    const leave = sectionBody(read(CLEANUP_DOC), /^## \d+\. Leave the worktree/);
    // `git worktree remove` refusing from inside the tree...
    expect(leave).toMatch(/refuses to remove the worktree the command is standing in/i);
    // ...and the deleted-cwd shell that breaks every later command.
    expect(leave).toMatch(/getcwd|No such file or directory/i);
  });

  it("resolves an anchor outside the worktree to move to", () => {
    const leave = sectionBody(read(CLEANUP_DOC), /^## \d+\. Leave the worktree/);
    expect(leave).toMatch(/git .*worktree list --porcelain/);
    expect(leave).toMatch(/main working tree/i);
  });

  it("compares resolved paths rather than strings", () => {
    const leave = sectionBody(read(CLEANUP_DOC), /^## \d+\. Leave the worktree/);
    expect(leave).toMatch(/resolved paths, not strings/i);
    expect(leave).toMatch(/symlink/i);
    // A sibling `<name>-old` must not read as inside `<name>`.
    expect(leave).toMatch(/path segments|sibling/i);
  });

  it("pins later commands to an explicit repo so nothing re-enters the tree", () => {
    const leave = sectionBody(read(CLEANUP_DOC), /^## \d+\. Leave the worktree/);
    expect(leave).toMatch(/git -C/);
  });

  it("verifies the cwd is both outside the worktree and still present", () => {
    const leave = sectionBody(read(CLEANUP_DOC), /^## \d+\. Leave the worktree/);
    const verify = leave.slice(leave.search(/\*\*Verify:\*\*/));
    expect(verify).toMatch(/outside/i);
    // Left, not deleted — a deleted cwd is the same stall one step later.
    expect(verify).toMatch(/still exists|deleted rather than left/i);
  });

  it("gives the step a report row so a skipped relocation stays visible", () => {
    expect(read(CLEANUP_DOC)).toContain("Left the worktree");
  });

  it("carries the never-remove-the-tree-you-stand-in rule into the worktree guide", () => {
    const doc = read(WORKTREES_DOC);
    expect(doc).toMatch(/never remove a worktree you are standing in/i);
  });
});

describe("post-merge cleanup reports blocked steps instead of waiting", () => {
  it("states that a blocked step is reported, not handed back to the user", () => {
    const doc = read(CLEANUP_DOC);
    expect(doc).toMatch(/blocked step is reported, never handed back/i);
  });

  it("rules out waiting as an outcome, given the gate pre-authorized the run", () => {
    const doc = read(CLEANUP_DOC);
    expect(doc).toMatch(/waiting for the user is not a fourth ending/i);
    expect(doc).toMatch(/already authorized this whole sequence/i);
  });

  it("separates obstacles to clear from obstacles to record", () => {
    const doc = read(CLEANUP_DOC);
    expect(doc).toMatch(/obstacle you can clear yourself/i);
    expect(doc).toMatch(/record(ed)? and stop/i);
  });

  it("prints the report on the blocked path too", () => {
    const doc = read(CLEANUP_DOC);
    expect(doc).toMatch(/print the report either way/i);
  });

  it("keeps the do/cleanup stage running through to its next-step suggestion", () => {
    const doc = read(DO_CLEANUP_DOC);
    expect(doc).toMatch(/teardown never returns a question/i);
    expect(doc).toMatch(/steps 4 and 5 always run|not complete until/i);
  });
});
