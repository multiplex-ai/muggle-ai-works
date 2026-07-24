/**
 * Static wiring lint for the never-push-unsigned rule. The muggle skills commit
 * and push in several flows (build commit, forward-mode PR open, address-reviews
 * push, rebase force-push); on a machine without local signing every cycle would
 * push unsigned commits. This test locks the wiring — the signed-commits recipe
 * exists and every push path routes through its signing gate. It reads the
 * files; it does not run git.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS = path.join(REPO_ROOT, "plugin", "skills");
const RECIPE = path.join(SKILLS, "_shared", "vcs", "github", "signed-commits.md");
const PUSH = path.join(SKILLS, "_shared", "vcs", "github", "push-to-branch.md");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("signed-commits recipe", () => {
  it("exists", () => {
    expect(fs.existsSync(RECIPE)).toBe(true);
  });

  const recipe = fs.existsSync(RECIPE) ? read(RECIPE) : "";

  it("states the rule and the server-signed mechanism", () => {
    expect(recipe).toMatch(/Never push unsigned commits/);
    expect(recipe).toMatch(/createCommitOnBranch/);
    expect(recipe).toMatch(/cat-file blob/);
    expect(recipe).toMatch(/expectedHeadOid/);
    expect(recipe).toMatch(/%G\?/);
  });

  it("covers the rebase-replay and GitLab escalation paths", () => {
    expect(recipe).toMatch(/## Rebase \/ force-push/);
    expect(recipe).toMatch(/## GitLab/);
  });
});

describe("push paths route through the signing gate", () => {
  it("push-to-branch.md links the recipe and gates before the push commands", () => {
    const push = read(PUSH);
    expect(push).toMatch(/signed-commits\.md/);
    const gate = push.indexOf("never push unsigned commits");
    const bash = push.indexOf("```bash");
    expect(gate, "no signing-gate text found").toBeGreaterThan(-1);
    expect(bash, "no push command block found").toBeGreaterThan(-1);
    expect(
      gate,
      "the signing gate must precede the push command block",
    ).toBeLessThan(bash);
  });

  it("build.md routes its commit through the recipe", () => {
    expect(read(path.join(SKILLS, "do", "build.md"))).toMatch(
      /signed-commits\.md/,
    );
  });

  it("open-prs/forward.md pushes through the gate and the recipe", () => {
    const forward = read(path.join(SKILLS, "do", "open-prs", "forward.md"));
    expect(forward).toMatch(/push-to-branch\.md/);
    expect(forward).toMatch(/signed-commits\.md/);
  });

  it("resolve-conflicts.md carries the replay path and keeps the lease", () => {
    const resolve = read(path.join(SKILLS, "do", "resolve-conflicts.md"));
    expect(resolve).toMatch(/signed-commits\.md/);
    expect(resolve).toMatch(/--force-with-lease/);
  });

  it("open-prs/update.md still routes its push through push-to-branch.md", () => {
    expect(read(path.join(SKILLS, "do", "open-prs", "update.md"))).toMatch(
      /push-to-branch\.md/,
    );
  });
});
