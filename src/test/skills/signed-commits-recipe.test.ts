/**
 * Static wiring lint for the never-push-unsigned rule. The muggle skills commit
 * and push in several flows (build commit, forward-mode PR open, address-reviews
 * push, rebase force-push); on a machine without local signing every cycle would
 * push unsigned commits. This test locks the wiring — each provider's
 * signed-commits recipe lives in its own recipe set and every push path routes
 * through the signing gate per provider. It reads the files; it does not run git.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS = path.join(REPO_ROOT, "plugin", "skills");
const GITHUB_RECIPE = path.join(
  SKILLS,
  "_shared",
  "vcs",
  "github",
  "signed-commits.md",
);
const GITLAB_RECIPE = path.join(
  SKILLS,
  "_shared",
  "vcs",
  "gitlab",
  "signed-commits.md",
);
const PUSH = path.join(SKILLS, "_shared", "vcs", "common", "push-to-branch.md");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("github signed-commits recipe", () => {
  it("exists", () => {
    expect(fs.existsSync(GITHUB_RECIPE)).toBe(true);
  });

  const recipe = fs.existsSync(GITHUB_RECIPE) ? read(GITHUB_RECIPE) : "";

  it("states the rule and the server-signed mechanism", () => {
    expect(recipe).toMatch(/Never push unsigned commits/);
    expect(recipe).toMatch(/createCommitOnBranch/);
    expect(recipe).toMatch(/cat-file blob/);
    expect(recipe).toMatch(/expectedHeadOid/);
    expect(recipe).toMatch(/%G\?/);
  });

  it("covers the rebase-replay path and stays GitHub-scoped", () => {
    expect(recipe).toMatch(/## Rebase \/ force-push/);
    expect(recipe).not.toMatch(/gitlab/i);
  });
});

describe("gitlab signed-commits recipe", () => {
  it("exists", () => {
    expect(fs.existsSync(GITLAB_RECIPE)).toBe(true);
  });

  const recipe = fs.existsSync(GITLAB_RECIPE) ? read(GITLAB_RECIPE) : "";

  it("states the rule and the escalation path", () => {
    expect(recipe).toMatch(/Never push unsigned commits/);
    expect(recipe).toMatch(/%G\?/);
    expect(recipe).toMatch(/stop and escalate/);
  });

  it("offers no server-side commit path", () => {
    expect(recipe).not.toMatch(/createCommitOnBranch/);
  });

  it("is indexed by the gitlab recipe set", () => {
    expect(read(path.join(SKILLS, "_shared", "vcs", "gitlab.md"))).toMatch(
      /gitlab\/signed-commits\.md/,
    );
  });
});

describe("push paths route through the signing gate", () => {
  it("push-to-branch.md is the tool-agnostic gate: routes per provider, embeds no commands", () => {
    const push = read(PUSH);
    expect(push).toMatch(/detect-vcs\.md/);
    expect(push).toMatch(/github\/signed-commits\.md/);
    expect(push).toMatch(/gitlab\/signed-commits\.md/);
    expect(push).toMatch(/never push unsigned commits/i);
    expect(
      push.includes("```"),
      "push-to-branch.md must stay tool-agnostic — provider recipes own the commands",
    ).toBe(false);
  });

  it("build.md commits through push-to-branch.md alone (single source of truth)", () => {
    const build = read(path.join(SKILLS, "do", "build.md"));
    expect(build).toMatch(/push-to-branch\.md/);
    expect(
      build,
      "provider routing lives in push-to-branch.md, not the commit site",
    ).not.toMatch(/signed-commits\.md/);
  });

  it("open-prs/forward.md pushes through push-to-branch.md alone (single source of truth)", () => {
    const forward = read(path.join(SKILLS, "do", "open-prs", "forward.md"));
    expect(forward).toMatch(/push-to-branch\.md/);
    expect(
      forward,
      "provider routing lives in push-to-branch.md, not the push site",
    ).not.toMatch(/signed-commits\.md/);
  });

  it("resolve-conflicts.md force-pushes through push-to-branch.md and keeps the lease", () => {
    const resolve = read(path.join(SKILLS, "do", "resolve-conflicts.md"));
    expect(resolve).toMatch(/push-to-branch\.md/);
    expect(resolve).toMatch(/--force-with-lease/);
  });

  it("open-prs/update.md still routes its push through push-to-branch.md", () => {
    expect(read(path.join(SKILLS, "do", "open-prs", "update.md"))).toMatch(
      /push-to-branch\.md/,
    );
  });
});
