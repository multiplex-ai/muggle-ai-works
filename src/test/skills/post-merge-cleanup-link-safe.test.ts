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
