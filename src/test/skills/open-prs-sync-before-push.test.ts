/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins the pre-push base sync in muggle-do's Stage 7. The harness used to sync
 * only inside Stage 6 (E2E) and at the top of the address-reviews cycle, so a
 * `unit-only` or `skip` run never synced at all, and even an E2E run went stale
 * while stages 3-6 built and tested. Either way the PR opened behind its base
 * and could not merge under a require-up-to-date policy.
 *
 * The ordering assertions carry the weight: a sync that runs after the push is
 * the original bug wearing the new step's name.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "plugin", "skills");
const SYNC_DOC = path.join(SKILLS_DIR, "_shared", "sync-branch-with-base.md");
const PRE_RENAME_DOC = path.join(SKILLS_DIR, "_shared", "rebase-before-e2e.md");
const FORWARD_DOC = path.join(SKILLS_DIR, "do", "open-prs", "forward.md");
const UPDATE_DOC = path.join(SKILLS_DIR, "do", "open-prs", "update.md");

const read = (file: string): string => fs.readFileSync(file, "utf8");

/** Body of one `## <heading>` section, up to the next `## ` heading. */
function sectionBody(doc: string, heading: string): string {
  const start = doc.indexOf(heading);
  if (start === -1) return "";
  const rest = doc.slice(start + heading.length);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Character offset of the numbered step with this bolded label, or -1. */
function stepOffset(body: string, label: string): number {
  return body.search(new RegExp(String.raw`^\d+\.\s+\*\*${label}`, "m"));
}

/** Numbers of every `N. **Label**` step in a section, in document order. */
function stepNumbers(body: string): number[] {
  return [...body.matchAll(/^(\d+)\.\s+\*\*/gm)].map((m) => Number(m[1]));
}

/** Bolded label of step `n`, trimmed of its trailing punctuation, or null. */
function stepLabel(body: string, n: number): string | null {
  const m = body.match(new RegExp(String.raw`^${n}\.\s+\*\*([^*:]+)`, "m"));
  return m ? m[1].trim() : null;
}

/** Every markdown file under plugin/skills. */
function listSkillMarkdown(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSkillMarkdown(full, acc);
    else if (entry.isFile() && entry.name.endsWith(".md")) acc.push(full);
  }
  return acc;
}

describe("the shared base-sync module", () => {
  it("lives at the base-neutral path, not the E2E-specific one", () => {
    expect(fs.existsSync(SYNC_DOC)).toBe(true);
    expect(fs.existsSync(PRE_RENAME_DOC)).toBe(false);
  });

  it("covers pushes, not dev-server and E2E alone", () => {
    expect(read(SYNC_DOC)).toMatch(/before any push|before a push/i);
  });

  it("parameterises the base instead of hardcoding the remote default", () => {
    // A change may target a branch other than origin/HEAD; syncing onto the
    // default there leaves the branch behind the branch it actually merges into.
    const doc = read(SYNC_DOC);
    expect(doc).toMatch(/\$\{base:-/);
    expect(doc).toMatch(/origin\/\$\{base\}/);
  });

  it("refuses to force-push from the shared module", () => {
    // Force-pushing needs an attempt budget and a verify-or-rollback gate, both
    // of which live in the caller's rebase mode.
    const doc = read(SYNC_DOC);
    expect(doc).toMatch(/never force-push from here/i);
    expect(doc).not.toMatch(/--force-with-lease/);
  });

  it("holds no link back up into a calling skill", () => {
    expect(read(SYNC_DOC)).not.toMatch(/\]\(\.\.\/do\//);
  });
});

describe("no skill file references the pre-rename path", () => {
  it("has zero occurrences of rebase-before-e2e across plugin/skills", () => {
    const offenders = listSkillMarkdown(SKILLS_DIR).filter((f) =>
      read(f).includes("rebase-before-e2e"),
    );
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });
});

describe("forward mode syncs before opening the PR", () => {
  const perRepo = sectionBody(read(FORWARD_DOC), "## Per repo");

  it("orders the sync step ahead of the push step", () => {
    const syncAt = stepOffset(perRepo, "Sync with the base");
    const pushAt = stepOffset(perRepo, "Push:");
    expect(syncAt).toBeGreaterThanOrEqual(0);
    expect(pushAt).toBeGreaterThanOrEqual(0);
    expect(syncAt).toBeLessThan(pushAt);
  });

  it("delegates the sync to the shared module behind the autoRebase gate", () => {
    expect(perRepo).toMatch(/sync-branch-with-base\.md/);
    expect(perRepo).toMatch(/autoRebase/);
    expect(perRepo).toMatch(/behind > 0/);
  });

  it("states why stage 6 cannot be trusted for freshness", () => {
    expect(perRepo).toMatch(/unit-only/);
    expect(perRepo).toMatch(/stages 3–6|stages 3-6/);
  });

  it("stops rather than opening a PR on a tree that failed verification", () => {
    expect(perRepo).toMatch(/never open a PR on a tree that did not verify/i);
  });

  it("numbers its steps consecutively from zero", () => {
    const numbers = stepNumbers(perRepo);
    expect(numbers.length).toBeGreaterThanOrEqual(6);
    expect(numbers).toEqual(numbers.map((_, i) => i));
  });

  it("keeps its step cross-references pointing at the right steps", () => {
    // Inserting the sync step renumbered everything after it; a cross-reference
    // left on the old number silently sends the reader to the wrong step.
    const doc = read(FORWARD_DOC);
    const signedIn = doc.match(/signed in Step (\d+)/);
    expect(signedIn).not.toBeNull();
    expect(stepLabel(perRepo, Number(signedIn![1]))).toBe("Body");

    const resolvedIn = [...doc.matchAll(/provider resolved in Step (\d+)/g)];
    expect(resolvedIn.length).toBeGreaterThan(0);
    for (const m of resolvedIn) {
      expect(stepLabel(perRepo, Number(m[1]))).toBe("Create");
    }
  });
});

describe("update mode syncs before pushing to an open PR", () => {
  const doc = read(UPDATE_DOC);
  const procedure = sectionBody(doc, "## Procedure");

  it("orders the sync step ahead of the push step", () => {
    const syncAt = stepOffset(procedure, "Sync with the base");
    const pushAt = stepOffset(procedure, "Push:");
    expect(syncAt).toBeGreaterThanOrEqual(0);
    expect(pushAt).toBeGreaterThanOrEqual(0);
    expect(syncAt).toBeLessThan(pushAt);
  });

  it("borrows the rebase mode's procedure rather than inlining one", () => {
    expect(procedure).toMatch(/resolve-conflicts\.md/);
    expect(procedure).toMatch(/verify-or-rollback/i);
  });

  it("refuses to dispatch the rebase mode, which owns its own respawn", () => {
    // Dispatching the whole mode would force-push and respawn the watcher while
    // the address-reviews orchestrator is still mid-cycle and owns the respawn.
    expect(procedure).toMatch(/do not dispatch the mode itself/i);
    expect(procedure).toMatch(/respawn/i);
  });

  it("force-pushes only because the rebase rewrote pushed commits", () => {
    expect(procedure).toMatch(/--force-with-lease/);
    expect(procedure).toMatch(/rewrote commits the remote already has/i);
  });

  it("prefers a branch left behind over a force-pushed unverified tree", () => {
    expect(procedure).toMatch(/stop without pushing/i);
  });

  it("numbers its steps consecutively from zero", () => {
    const numbers = stepNumbers(procedure);
    expect(numbers.length).toBeGreaterThanOrEqual(6);
    expect(numbers).toEqual(numbers.map((_, i) => i));
  });
});
