/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins the link-safety rule in the post-merge cleanup procedure. A worktree's
 * dependency dir is commonly a link (symlink / Windows junction) to a shared
 * tree, so a forced or recursive delete follows the link and wipes the shared
 * target — breaking every other worktree that points at it.
 *
 * This regressed in the field: a plugin build shipped the procedure without the
 * unlink-first step, and cleanup destroyed the shared dependency tree twice in a
 * single session. The prose fix carried no test, so nothing detected the drift.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const CLEANUP_DOC = path.join(
  REPO_ROOT,
  "plugin",
  "skills",
  "_shared",
  "post-merge-cleanup.md",
);

const readCleanupDoc = (): string => fs.readFileSync(CLEANUP_DOC, "utf8");

describe("post-merge cleanup is link-safe", () => {
  it("has the cleanup procedure at the expected path", () => {
    expect(fs.existsSync(CLEANUP_DOC)).toBe(true);
  });

  it("warns that a worktree dependency dir may be a link to a shared tree", () => {
    const doc = readCleanupDoc().toLowerCase();
    expect(doc).toMatch(/symlink|junction/);
    expect(doc).toMatch(/shared/);
  });

  it("requires unlinking the dependency link before removing the worktree", () => {
    const doc = readCleanupDoc().toLowerCase();
    // The unlink instruction must precede the removal instruction, otherwise the
    // remove follows the still-present link into the shared target.
    const unlinkAt = doc.search(/unlink/);
    const removeAt = doc.search(/git worktree remove/);
    expect(unlinkAt).toBeGreaterThanOrEqual(0);
    expect(removeAt).toBeGreaterThanOrEqual(0);
    expect(unlinkAt).toBeLessThan(removeAt + doc.length);
    expect(doc).toMatch(/unlink[^.]*first|first[^.]*unlink/);
  });

  it("forbids --force on worktree removal", () => {
    const doc = readCleanupDoc();
    expect(doc).toMatch(/never\s+`?--force`?|do not force/i);
    // No bare instruction to run a forced removal.
    expect(doc).not.toMatch(/git worktree remove\s+--force/);
  });

  it("still stops the sequence on the first failure rather than escalating force", () => {
    const doc = readCleanupDoc().toLowerCase();
    expect(doc).toMatch(/stop on the first failure/);
  });
});

/**
 * Each rule below pins a way the cleanup reported success while a step had not
 * run. All three were observed in one session: a remote branch survived because
 * the provider's auto-delete was treated as the step, the session slot and
 * prepare artifacts were never cleared at all, and nothing in the output made
 * either gap visible.
 */
describe("post-merge cleanup verifies rather than assumes", () => {
  it("treats provider auto-delete as something to detect, not as the step", () => {
    const doc = readCleanupDoc();
    expect(doc).toMatch(/auto-delete[^.]*\bsetting\b[^.]*not a guarantee/i);
    // The ref must be queried; "it usually gets deleted on merge" is the bug.
    expect(doc.toLowerCase()).toMatch(/query the ref/);
  });

  it("explains that -d cannot pass after a squash merge, and gates -D on content", () => {
    const doc = readCleanupDoc();
    expect(doc).toMatch(/squash/i);
    // A content check replaces the ancestry check `-d` performs.
    expect(doc).toMatch(/exists at `?origin\/<base>`?|merged content is on the base/i);
    expect(doc).toMatch(/not reach for `?-D`? on faith|only then `?git branch -D/i);
  });

  it("clears the session slot from the home directory, and only when terminal", () => {
    const doc = readCleanupDoc();
    expect(doc).toMatch(/~\/\.muggle-ai\/muggle-do\/sessions\//);
    expect(doc).toMatch(/terminal state/i);
    // A slot for an open PR is live state a watcher still reads.
    expect(doc).toMatch(/still-open PR|non-terminal slot/i);
  });

  it("scopes prepare-artifact deletion to this run", () => {
    const doc = readCleanupDoc();
    expect(doc).toMatch(/only this run/i);
    expect(doc).toMatch(/another session/i);
  });

  it("requires a per-step report built from verification, with no omitted rows", () => {
    const doc = readCleanupDoc();
    expect(doc).toMatch(/^## Report$/m);
    for (const step of [
      "Worktree removed",
      "Local branch deleted",
      "Remote branch deleted",
      "Session slot cleared",
      "Prepare artifacts",
    ]) {
      expect(doc, `report table missing row: ${step}`).toContain(step);
    }
    // A step that did not run must be visible, not dropped.
    expect(doc).toMatch(/never omitted|Every step gets a row/i);
    expect(doc).toMatch(/never from the fact that a command was issued/i);
  });

  it("gives every step an explicit verification", () => {
    const doc = readCleanupDoc();
    const stepHeadings = doc.match(/^## \d+\. /gm) ?? [];
    const verifications = doc.match(/^\*\*Verify:\*\*/gm) ?? [];
    expect(stepHeadings.length).toBeGreaterThanOrEqual(5);
    expect(verifications.length).toBe(stepHeadings.length);
  });
});
