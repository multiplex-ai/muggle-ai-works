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
    expect(resolveTreeChange(PROMPT_TREE, stubGit)).toEqual({ repo: "github.com/acme/prompt-service", branch: "users/me/fanout-primary" });
  });

  it("is unknown on a detached HEAD or outside a repo", () => {
    expect(resolveTreeChange(PROMPT_TREE, (args) => (args[0] === "branch" ? "\n" : "https://github.com/acme/x\n"))).toBeUndefined();
    expect(resolveTreeChange("C:\\nowhere", stubGit)).toBeUndefined();
    expect(resolveTreeChange(undefined, stubGit)).toBeUndefined();
  });
});

describe("resolveOpenedPrChange", () => {
  it("takes the repo from the PR URL and the branch from --head, wherever the command ran", () => {
    const command = `Push-Location "${UI_TREE}"; gh pr create -R acme/ui --base master --head users/me/multispec-name --title "x"`;
    expect(resolveOpenedPrChange(command, UI_PR, PROMPT_TREE, stubGit)).toEqual({ repo: "github.com/acme/ui", branch: "users/me/multispec-name" });
  });

  it("drops a fork owner prefix and reads the = and short spellings", () => {
    expect(resolveOpenedPrChange("gh pr create --head=me:fix", UI_PR, undefined, stubGit)?.branch).toBe("fix");
    expect(resolveOpenedPrChange("gh pr create -H 'fix'", UI_PR, undefined, stubGit)?.branch).toBe("fix");
    expect(resolveOpenedPrChange("glab mr create --source-branch fix", UI_PR, undefined, stubGit)?.branch).toBe("fix");
  });

  it("falls back to the hook tree's branch only when the command stayed there and the tree is in the PR's repo", () => {
    expect(resolveOpenedPrChange("gh pr create --fill", PROMPT_PR, PROMPT_TREE, stubGit)).toEqual({
      repo: "github.com/acme/prompt-service",
      branch: "users/me/fanout-primary",
    });
    expect(resolveOpenedPrChange("gh pr create -R acme/ui --fill", UI_PR, PROMPT_TREE, stubGit)).toBeUndefined();
    expect(resolveOpenedPrChange(`cd "${UI_TREE}" && gh pr create --fill`, UI_PR, PROMPT_TREE, stubGit)).toBeUndefined();
    expect(resolveOpenedPrChange(`Push-Location "${UI_TREE}"; gh pr create --fill`, PROMPT_PR, PROMPT_TREE, stubGit)).toBeUndefined();
  });

  it("ignores a head-like flag that comes before the PR command", () => {
    const command = `curl -H "Accept: x" https://example.com; gh pr create --fill`;
    expect(resolveOpenedPrChange(command, PROMPT_PR, PROMPT_TREE, stubGit)?.branch).toBe("users/me/fanout-primary");
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
    const promptChange = resolveTreeChange(PROMPT_TREE, stubGit);
    const promptOpened = applyPrOpenedToSkipScope(
      { sessionId: "s", prsHandled: [PROMPT_PR] } satisfies GuardrailState,
      PROMPT_PR,
      resolveOpenedPrChange("gh pr create --fill", PROMPT_PR, PROMPT_TREE, stubGit),
    );
    const skipped = applyE2eSkipScope({ ...promptOpened, e2eSkipDeclaration: skip }, promptChange);
    const uiCommand =
      `Push-Location "${UI_TREE}"; gh pr create -R acme/ui --base master ` +
      `--head users/me/multispec-name --title "x"; Pop-Location`;
    const uiOpened = applyPrOpenedToSkipScope(
      { ...skipped, prsHandled: [...skipped.prsHandled, UI_PR] },
      UI_PR,
      resolveOpenedPrChange(uiCommand, UI_PR, PROMPT_TREE, stubGit),
    );
    expect(isPrCoveredBySkip(uiOpened, PROMPT_PR)).toBe(true);
    expect(isPrCoveredBySkip(uiOpened, UI_PR)).toBe(false);
  });
});
