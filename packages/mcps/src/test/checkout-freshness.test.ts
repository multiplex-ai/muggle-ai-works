/** Tests for the checkout-freshness evaluator, against real repositories. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CheckoutFreshnessVerdict,
  evaluateCheckoutFreshness,
  runGitCommand,
  type ICheckoutFreshnessReport,
} from "../shared/checkout-freshness.js";

let fixtureRoot = "";

// The fixture spawns ~25 git processes; on Windows under a parallel suite that alone nears the default ceiling.
const FIXTURE_SETUP_TIMEOUT_MS = 60_000;

// HOME points at the fixture so a contributor's global git config — signing above all — never reaches its commits.
const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, {
    cwd: cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: fixtureRoot,
      USERPROFILE: fixtureRoot,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  }).trim();

const commitEmpty = (cwd: string, message: string): void => {
  git(cwd, "commit", "-q", "--allow-empty", "-m", message);
};

const at = (name: string): string => join(fixtureRoot, name);

const evaluateAt = (name: string, overrides: { baseBranch?: string; shouldFetchBase?: boolean } = {}) =>
  evaluateCheckoutFreshness({
    cwd: at(name),
    baseBranch: overrides.baseBranch,
    shouldFetchBase: overrides.shouldFetchBase ?? false,
    runGit: runGitCommand,
  });

const samePath = (actual: string | null, expected: string): void => {
  expect(resolve(actual ?? "").toLowerCase()).toBe(resolve(expected).toLowerCase());
};

// origin: master = base → m2, feat-a = base → a1. The clone's worktrees each take one shape.
beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "checkout-freshness-"));
  git(fixtureRoot, "init", "-q", "-b", "master", "origin");
  commitEmpty(at("origin"), "base");
  git(at("origin"), "checkout", "-q", "-b", "feat-a");
  commitEmpty(at("origin"), "a1");
  git(at("origin"), "checkout", "-q", "master");
  git(fixtureRoot, "clone", "-q", "origin", "clone");

  git(at("clone"), "worktree", "add", "-q", at("stale"), "-b", "stale", "origin/master");
  commitEmpty(at("origin"), "m2");
  git(at("clone"), "fetch", "-q", "origin");

  git(at("clone"), "worktree", "add", "-q", at("fresh"), "-b", "fresh", "origin/master");
  git(at("clone"), "worktree", "add", "-q", at("cut"), "-b", "cut", "origin/feat-a");
  git(at("clone"), "worktree", "add", "-q", at("pr"), "feat-a");
  git(at("clone"), "worktree", "add", "-q", at("rebased"), "-b", "rebased", "origin/feat-a");
  git(at("rebased"), "rebase", "-q", "--onto", "origin/master", "origin/feat-a");
  git(at("clone"), "worktree", "add", "-q", "--detach", at("detached"), "origin/master");

  git(fixtureRoot, "init", "-q", "-b", "master", "no-origin");
  commitEmpty(at("no-origin"), "solo");
  mkdirSync(at("plain"));
}, FIXTURE_SETUP_TIMEOUT_MS);

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("evaluateCheckoutFreshness", () => {
  it("reports FRESH for a branch created from the latest base", async () => {
    const report = await evaluateAt("fresh");
    expect(report.verdict).toBe(CheckoutFreshnessVerdict.Fresh);
    expect(report.branch).toBe("fresh");
    expect(report.baseRef).toBe("refs/remotes/origin/master");
    expect(report.behindBy).toBe(0);
    expect(report.reason).toContain("HEAD contains origin/master");
    samePath(report.checkoutRoot, at("fresh"));
    samePath(report.mainWorktreeRoot, at("clone"));
  });

  it("reports BEHIND_BASE with the count of base commits HEAD lacks", async () => {
    const report = await evaluateAt("stale");
    expect(report.verdict).toBe(CheckoutFreshnessVerdict.BehindBase);
    expect(report.behindBy).toBe(1);
    expect(report.reason).toContain("1 commit behind origin/master");
  });

  it("reports FOREIGN_BASE for a branch cut from another branch's unmerged work", async () => {
    const report = await evaluateAt("cut");
    expect(report.verdict).toBe(CheckoutFreshnessVerdict.ForeignBase);
    expect(report.inheritedCommitCount).toBe(1);
    expect(report.inheritedCommits).toHaveLength(1);
    expect(report.inheritedCommits[0]).toMatch(/^[0-9a-f]+ a1$/);
    expect(report.reason).toContain("created from origin/feat-a");
    expect(report.behindBy).toBe(1);
  });

  it("accepts a stacked branch checked against the branch it stacks on", async () => {
    const report = await evaluateAt("cut", { baseBranch: "feat-a" });
    expect(report.verdict).toBe(CheckoutFreshnessVerdict.Fresh);
    expect(report.baseRef).toBe("refs/remotes/origin/feat-a");
  });

  it("never calls a branch materialized from its own remote copy foreign", async () => {
    const report = await evaluateAt("pr");
    expect(report.verdict).toBe(CheckoutFreshnessVerdict.BehindBase);
    expect(report.creationSha).toBeNull();
  });

  it("clears a branch whose inherited commits were rebased away", async () => {
    const report = await evaluateAt("rebased");
    expect(report.verdict).toBe(CheckoutFreshnessVerdict.Fresh);
    expect(report.creationSha).not.toBeNull();
    expect(report.inheritedCommits).toEqual([]);
  });

  it("checks a detached HEAD on ancestry alone", async () => {
    const report = await evaluateAt("detached");
    expect(report.verdict).toBe(CheckoutFreshnessVerdict.Fresh);
    expect(report.branch).toBeNull();
  });

  it.each([
    ["plain", {}, "not inside a git checkout"],
    ["no-origin", {}, "no origin remote"],
    ["fresh", { baseBranch: "missing" }, "base branch missing exists neither"],
  ])("reports NOT_APPLICABLE for %s %o", async (name, overrides, reason) => {
    const report: ICheckoutFreshnessReport = await evaluateAt(name, overrides);
    expect(report.verdict).toBe(CheckoutFreshnessVerdict.NotApplicable);
    expect(report.reason).toContain(reason);
  });

  it("fetches the base before judging when asked", async () => {
    git(fixtureRoot, "clone", "-q", "origin", "fetching");
    commitEmpty(at("origin"), "m3");

    expect((await evaluateAt("fetching")).verdict).toBe(CheckoutFreshnessVerdict.Fresh);
    const fetched = await evaluateAt("fetching", { shouldFetchBase: true });
    expect(fetched.verdict).toBe(CheckoutFreshnessVerdict.BehindBase);
    expect(fetched.behindBy).toBe(1);
    expect(fetched.hasFetchFailed).toBe(false);
  });

  it("falls back to the last fetched base when the fetch fails", async () => {
    git(fixtureRoot, "clone", "-q", "origin", "offline");
    git(at("offline"), "remote", "set-url", "origin", at("unreachable"));

    const report = await evaluateAt("offline", { shouldFetchBase: true });
    expect(report.hasFetchFailed).toBe(true);
    expect(report.verdict).toBe(CheckoutFreshnessVerdict.Fresh);
  });
});
