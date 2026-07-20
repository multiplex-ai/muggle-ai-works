/**
 * Static lint for the muggle-pr-followup watcher's rebase dedup key.
 *
 * Whether a branch conflicts is a function of both sides — head and base.
 * An earlier contract deduped rebase dispatch on the head SHA alone, which
 * wedges a PR permanently the first time the base moves: the new conflict is
 * real, but the stale entry suppresses it, and nothing can change the head
 * while the branch sits blocked. Observed on muggle-ai-prompt-service#674,
 * which idled ~1000 ticks against a conflict no tick would ever dispatch.
 *
 * The fix keys rebase dedup on `rebase_key = "<head_sha>..<base_tip_sha>"`
 * while leaving CI dedup on the head alone (a CI result really is a function
 * of the head). These samples pin both halves. They check the contract text,
 * so they catch an edit that reintroduces the head-only key; they do NOT
 * catch an agent that reads the contract correctly and ignores it.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS_DIR = path.join(REPO_ROOT, "plugin", "skills");
const WATCHER_DIR = path.join(SKILLS_DIR, "muggle-pr-followup");

const contract = fs.readFileSync(path.join(WATCHER_DIR, "contract.md"), "utf8");
const schemas = fs.readFileSync(
  path.join(WATCHER_DIR, "state-schemas.md"),
  "utf8",
);
const resolveConflicts = fs.readFileSync(
  path.join(SKILLS_DIR, "do", "resolve-conflicts.md"),
  "utf8",
);

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

interface Sample {
  name: string;
  check: () => void;
}

const samples: Sample[] = [
  {
    name: "1. the rebase guard keys on the pair, never the bare head",
    check: () => {
      expect(contract).toMatch(/conflict_resolve_attempts\[rebase_key\]\s*<\s*2/);
      expect(contract).toMatch(/rebase_key`?\s*∉\s*`?conflict_escalated_keys/);
      expect(
        /conflict_resolve_attempts\[head_sha\]/.test(contract),
        "head-only rebase budget is the #674 regression",
      ).toBe(false);
    },
  },
  {
    name: "2. rebase_key is defined as head..base_tip",
    check: () => {
      expect(contract).toMatch(
        /rebase_key\s*=\s*"?<head_sha>\.\.<base_tip_sha>"?/,
      );
    },
  },
  {
    name: "3. Step 1 captures the base tip from the compare",
    check: () => {
      const step1 = contract.slice(
        contract.indexOf("### Step 1"),
        contract.indexOf("### Step 2"),
      );
      expect(step1).toMatch(/\.base_commit\.sha/);
      expect(step1).toMatch(/base_tip_sha/);
    },
  },
  {
    name: "4. the contract rules out .merge_base_commit.sha as the key source",
    check: () => {
      expect(contract).toMatch(/merge_base_commit\.sha/);
      const sentence = contract
        .split("\n")
        .find((l) => l.includes("merge_base_commit.sha"));
      expect(sentence).toMatch(/never|not/i);
    },
  },
  {
    name: "5. the budget-spent fall-through uses the same key as the trigger",
    check: () => {
      expect(contract).toMatch(
        /conflict_resolve_attempts\[rebase_key\]\s*>=\s*2/,
      );
      expect(contract).toMatch(/rebase_key`?\s*∈\s*`?conflict_escalated_keys/);
    },
  },
  {
    name: "6. NEGATIVE — CI dedup stays keyed on the head alone",
    check: () => {
      expect(contract).toMatch(/ci_fix_attempts\[head_sha\]/);
      expect(contract).toMatch(/head_sha`?\s*∉\s*`?ci_escalated_shas/);
      expect(
        /ci_fix_attempts\[rebase_key\]|ci_escalated_keys/.test(contract),
        "CI is a function of the head only — base movement must not re-arm it",
      ).toBe(false);
    },
  },
  {
    name: "7. the schema documents the composite key shape",
    check: () => {
      expect(schemas).toMatch(/conflict_escalated_keys/);
      expect(schemas).toMatch(
        /conflict_resolve_attempts.*<head-sha>\.\.<base-tip-sha>/,
      );
      expect(schemas).toMatch(/ci_fix_attempts.*<sha>/);
    },
  },
  {
    name: "8. the superseded head-only rationale is gone",
    check: () => {
      expect(
        /A clean behind-only rebase produces a new SHA/.test(schemas),
        "this sentence justified the head-only key by assuming the head always moves",
      ).toBe(false);
    },
  },
  {
    name: "9. the contract explains why the pair is required",
    check: () => {
      expect(contract).toMatch(/base\b[^.]{0,60}\bmoves?\b/i);
      expect(contract).toMatch(/wedge|permanent|forever/i);
    },
  },
  {
    name: "10. legacy bare-SHA entries are explicitly ignored",
    check: () => {
      expect(contract).toMatch(/no\s+`?\.\.`?|bare head SHAs?/i);
      expect(contract).toMatch(/ignore/i);
    },
  },
  {
    name: "11. the writer records the same composite key the watcher reads",
    check: () => {
      expect(resolveConflicts).toMatch(
        /rebase_key\s*=\s*"?<rebase_sha>\.\.<base_tip_sha>"?/,
      );
      expect(resolveConflicts).toMatch(
        /conflict_resolve_attempts\[rebase_key\]/,
      );
      expect(resolveConflicts).toMatch(/conflict_escalated_keys/);
      expect(
        /conflict_escalated_shas/.test(resolveConflicts),
        "a bare SHA here writes an entry the watcher ignores — rebase re-dispatches forever",
      ).toBe(false);
    },
  },
];

describe("muggle-pr-followup rebase dedup key", () => {
  for (const sample of samples) {
    it(sample.name, sample.check);
  }

  it("no skill file still names the head-only escalation set", () => {
    const offenders = markdownFiles(SKILLS_DIR).filter((file) =>
      /conflict_escalated_shas/.test(fs.readFileSync(file, "utf8")),
    );
    expect(
      offenders.map((f) => path.relative(REPO_ROOT, f)),
      "conflict_escalated_shas was renamed to conflict_escalated_keys",
    ).toEqual([]);
  });
});
