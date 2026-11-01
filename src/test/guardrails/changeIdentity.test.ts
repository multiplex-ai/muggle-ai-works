import { join, resolve } from "path";
import { describe, it, expect } from "vitest";
import {
  isSameChange,
  repoKeyOfPrUrl,
  repoKeyOfRemoteUrl,
  resolveOpenedPrChange,
  resolveTreeChange,
} from "../../guardrails/changeIdentity";
import { applyE2eSkipScope, applyPrOpenedToSkipScope, isPrCoveredBySkip } from "../../guardrails/skipScope";
import { E2eSkipCode } from "../../e2e-skip/types";
import type { GuardrailState } from "../../guardrails/types";

const PROMPT_TREE = "C:\\work\\_wt-fanout-primary";
const UI_TREE = "C:\\work\\_wt-ui-multispec-name";
const PROMPT_PR = "https://github.com/acme/prompt-service/pull/974";
const UI_PR = "https://github.com/acme/ui/pull/690";

// Each tree's origin and checked-out branch, as `git` would print them.
const trees: Record<string, { remote: string; branch: string }> = {
  [PROMPT_TREE]: { remote: "https://github.com/acme/prompt-service.git\n", branch: "users/me/fanout-primary\n" },
  [UI_TREE]: { remote: "git@github.com:acme/ui.git\n", branch: "users/me/multispec-name\n" },
};

function stubGit(args: string[], cwd: string): string | null {
  const tree = trees[cwd];
  if (!tree) return null;
  if (args[0] === "remote") return tree.remote;
  if (args[0] === "branch") return tree.branch;
  return null;
}

const noGitFiles = (): string | null => null;

// Trees with no readable git files, so every lookup falls through to git.
const gitOnly = { readTextFile: noGitFiles, runGit: stubGit };

// A linked worktree of the prompt-service repo laid out on disk as git writes it.
// Resolved, because the reader resolves the tree it is given: a drive-letter
// path is relative on POSIX, and the keys must match on every platform.
const MAIN_GIT_DIR = resolve("C:\\work", "prompt-service", ".git");
const worktreeFiles: Record<string, string> = {
  [join(resolve(PROMPT_TREE), ".git")]: `gitdir: ${join(MAIN_GIT_DIR, "worktrees", "fanout-primary")}\n`,
  [join(MAIN_GIT_DIR, "worktrees", "fanout-primary", "HEAD")]: "ref: refs/heads/users/me/fanout-primary\n",
  [join(MAIN_GIT_DIR, "worktrees", "fanout-primary", "commondir")]: "../..\n",
  [join(MAIN_GIT_DIR, "config")]:
    '[core]\n\tbare = false\n[remote "origin"]\n\turl = https://github.com/acme/prompt-service.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
};

function filesWith(overrides: Record<string, string>): (path: string) => string | null {
  const files = { ...worktreeFiles, ...overrides };
  return (path) => files[path] ?? null;
}

function countingGit(): { runGit: typeof stubGit; spawned: string[][] } {
  const spawned: string[][] = [];
  return { runGit: (args, cwd) => (spawned.push(args), stubGit(args, cwd)), spawned: spawned };
}

describe("repo keys", () => {
  it("keys a PR URL and every remote spelling of its repo the same", () => {
    const expected = "github.com/acme/ui";
    expect(repoKeyOfPrUrl("https://github.com/acme/ui/pull/690")).toBe(expected);
    expect(repoKeyOfRemoteUrl("https://github.com/acme/ui.git")).toBe(expected);
    expect(repoKeyOfRemoteUrl("https://token@github.com/Acme/UI")).toBe(expected);
    expect(repoKeyOfRemoteUrl("git@github.com:acme/ui.git")).toBe(expected);
    expect(repoKeyOfRemoteUrl("ssh://git@github.com:22/acme/ui.git")).toBe(expected);
  });

  it("keys a GitLab MR by its full group path", () => {
    expect(repoKeyOfPrUrl("https://gitlab.example.com/group/sub/web/-/merge_requests/4")).toBe("gitlab.example.com/group/sub/web");
    expect(repoKeyOfRemoteUrl("git@gitlab.example.com:group/sub/web.git")).toBe("gitlab.example.com/group/sub/web");
  });

  it("keys nothing for a URL that is neither", () => {
    expect(repoKeyOfPrUrl("https://example.com/not/a/pr")).toBeUndefined();
    expect(repoKeyOfRemoteUrl("not a url")).toBeUndefined();
  });
});

describe("resolveTreeChange", () => {
  it("reads the tree's origin repo and checked-out branch", () => {
    expect(resolveTreeChange(PROMPT_TREE, gitOnly)).toEqual({ repo: "github.com/acme/prompt-service", branch: "users/me/fanout-primary" });
  });

  it("is unknown on a detached HEAD or outside a repo", () => {
    expect(resolveTreeChange(PROMPT_TREE, { readTextFile: noGitFiles, runGit: (args) => (args[0] === "branch" ? "\n" : "https://github.com/acme/x\n") })).toBeUndefined();
    expect(resolveTreeChange("C:\\nowhere", gitOnly)).toBeUndefined();
    expect(resolveTreeChange(undefined, gitOnly)).toBeUndefined();
  });

  it("answers a linked worktree from its git files without spawning git, from the root or a subdirectory", () => {
    const git = countingGit();
    const probes = { readTextFile: filesWith({}), runGit: git.runGit };
    const expected = { repo: "github.com/acme/prompt-service", branch: "users/me/fanout-primary" };
    expect(resolveTreeChange(PROMPT_TREE, probes)).toEqual(expected);
    expect(resolveTreeChange(join(PROMPT_TREE, "src", "server"), probes)).toEqual(expected);
    expect(git.spawned).toEqual([]);
  });

  it("is unknown on a detached HEAD read from disk, without asking git", () => {
    const git = countingGit();
    const detachedHead = { [join(MAIN_GIT_DIR, "worktrees", "fanout-primary", "HEAD")]: "0123456789abcdef0123456789abcdef01234567\n" };
    expect(resolveTreeChange(PROMPT_TREE, { readTextFile: filesWith(detachedHead), runGit: git.runGit })).toBeUndefined();
    expect(git.spawned).toEqual([]);
  });

  it("asks git for the remote when the config rewrites or includes URLs, or names none", () => {
    for (const config of [
      '[url "https://github.com/"]\n\tinsteadOf = gh:\n[remote "origin"]\n\turl = gh:acme/prompt-service\n',
      '[include]\n\tpath = ../shared.gitconfig\n[remote "origin"]\n\turl = https://github.com/acme/other.git\n',
      '[remote "upstream"]\n\turl = https://github.com/acme/upstream.git\n',
    ]) {
      const git = countingGit();
      const readTextFile = filesWith({ [join(MAIN_GIT_DIR, "config")]: config });
      expect(resolveTreeChange(PROMPT_TREE, { readTextFile: readTextFile, runGit: git.runGit })?.repo).toBe("github.com/acme/prompt-service");
      expect(git.spawned).toEqual([["remote", "get-url", "origin"]]);
    }
  });
});

describe("resolveOpenedPrChange", () => {
  it("takes the repo from the PR URL and the branch from --head, wherever the command ran", () => {
    const command = `Push-Location "${UI_TREE}"; gh pr create -R acme/ui --base master --head users/me/multispec-name --title "x"`;
    expect(resolveOpenedPrChange(command, UI_PR, PROMPT_TREE, gitOnly)).toEqual({ repo: "github.com/acme/ui", branch: "users/me/multispec-name" });
  });

  it("drops a fork owner prefix and reads the = and short spellings", () => {
    expect(resolveOpenedPrChange("gh pr create --head=me:fix", UI_PR, undefined, gitOnly)?.branch).toBe("fix");
    expect(resolveOpenedPrChange("gh pr create -H 'fix'", UI_PR, undefined, gitOnly)?.branch).toBe("fix");
    expect(resolveOpenedPrChange("glab mr create --source-branch fix", UI_PR, undefined, gitOnly)?.branch).toBe("fix");
  });

  it("falls back to the hook tree's branch only when the command stayed there and the tree is in the PR's repo", () => {
    expect(resolveOpenedPrChange("gh pr create --fill", PROMPT_PR, PROMPT_TREE, gitOnly)).toEqual({
      repo: "github.com/acme/prompt-service",
      branch: "users/me/fanout-primary",
    });
    expect(resolveOpenedPrChange("gh pr create -R acme/ui --fill", UI_PR, PROMPT_TREE, gitOnly)).toBeUndefined();
    expect(resolveOpenedPrChange(`cd "${UI_TREE}" && gh pr create --fill`, UI_PR, PROMPT_TREE, gitOnly)).toBeUndefined();
    expect(resolveOpenedPrChange(`Push-Location "${UI_TREE}"; gh pr create --fill`, PROMPT_PR, PROMPT_TREE, gitOnly)).toBeUndefined();
  });

  it("ignores a head-like flag that comes before the PR command", () => {
    const command = `curl -H "Accept: x" https://example.com; gh pr create --fill`;
    expect(resolveOpenedPrChange(command, PROMPT_PR, PROMPT_TREE, gitOnly)?.branch).toBe("users/me/fanout-primary");
  });
});

describe("isSameChange", () => {
  it("never matches an unknown side", () => {
    const change = { repo: "github.com/acme/ui", branch: "main" };
    expect(isSameChange(change, { ...change })).toBe(true);
    expect(isSameChange(change, undefined)).toBe(false);
    expect(isSameChange(undefined, undefined)).toBe(false);
  });
});

describe("a skip verified in one repo's tree, then a PR opened in another repo through Push-Location", () => {
  it("leaves the other repo's PR uncovered, so its slot is reserved rather than stamped with the skip", () => {
    const skip = { code: E2eSkipCode.NoWebSurface, detail: "prompt-service is a backend API" };
    const promptChange = resolveTreeChange(PROMPT_TREE, gitOnly);
    const promptOpened = applyPrOpenedToSkipScope(
      { sessionId: "s", prsHandled: [PROMPT_PR] } satisfies GuardrailState,
      PROMPT_PR,
      resolveOpenedPrChange("gh pr create --fill", PROMPT_PR, PROMPT_TREE, gitOnly),
    );
    const skipped = applyE2eSkipScope({ ...promptOpened, e2eSkipDeclaration: skip }, promptChange);
    const uiCommand =
      `Push-Location "${UI_TREE}"; gh pr create -R acme/ui --base master ` +
      `--head users/me/multispec-name --title "x"; Pop-Location`;
    const uiOpened = applyPrOpenedToSkipScope(
      { ...skipped, prsHandled: [...skipped.prsHandled, UI_PR] },
      UI_PR,
      resolveOpenedPrChange(uiCommand, UI_PR, PROMPT_TREE, gitOnly),
    );
    expect(isPrCoveredBySkip(uiOpened, PROMPT_PR)).toBe(true);
    expect(isPrCoveredBySkip(uiOpened, UI_PR)).toBe(false);
  });
});
