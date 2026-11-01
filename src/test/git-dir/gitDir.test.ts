import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { locateGitDir, readCurrentBranch, readRemoteHeadBranch, readRemoteUrl } from "../../git-dir/gitDir";

const readTextFile = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const git = (args: string[], cwd: string): string =>
  execFileSync("git", args, { cwd: cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();

// Every reader is held to what git itself prints for the same tree, in a real
// repo with a linked worktree, so the file layout is git's and not a guess.
describe("reading a working tree's git files", () => {
  let root: string;
  let mainTree: string;
  let linkedTree: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "muggle-git-dir-"));
    mainTree = join(root, "main");
    linkedTree = join(root, "linked");
    mkdirSync(mainTree);
    git(["init", "-q", "-b", "main"], mainTree);
    git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], mainTree);
    git(["remote", "add", "origin", "git@github.com:acme/web.git"], mainTree);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"], mainTree);
    git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], mainTree);
    git(["worktree", "add", "-q", "-b", "users/me/fix-login", linkedTree], mainTree);
    mkdirSync(join(linkedTree, "src", "deep"), { recursive: true });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it.each([
    ["the main tree", () => mainTree],
    ["a linked worktree", () => linkedTree],
    ["a linked worktree's subdirectory", () => join(linkedTree, "src", "deep")],
  ])("matches git in %s", (_label, treeOf) => {
    const cwd = treeOf();
    expect(readCurrentBranch(cwd, readTextFile)).toBe(git(["branch", "--show-current"], cwd));
    expect(readRemoteUrl(cwd, "origin", readTextFile)).toBe(git(["remote", "get-url", "origin"], cwd));
    expect(readRemoteHeadBranch(cwd, "origin", readTextFile)).toBe(git(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], cwd));
  });

  it("reads a detached HEAD as no branch, as git does", () => {
    git(["checkout", "-q", "--detach"], linkedTree);
    expect(readCurrentBranch(linkedTree, readTextFile)).toBe("");
    expect(git(["branch", "--show-current"], linkedTree)).toBe("");
    git(["checkout", "-q", "users/me/fix-login"], linkedTree);
  });

  it("finds nothing outside a repo", () => {
    const outside = mkdtempSync(join(tmpdir(), "muggle-no-git-"));
    try {
      expect(locateGitDir(outside, readTextFile)).toBeNull();
      expect(readCurrentBranch(outside, readTextFile)).toBeNull();
      expect(readRemoteUrl(outside, "origin", readTextFile)).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("leaves a remote with no symbolic HEAD to git", () => {
    expect(readRemoteHeadBranch(mainTree, "upstream", readTextFile)).toBeNull();
  });
});
