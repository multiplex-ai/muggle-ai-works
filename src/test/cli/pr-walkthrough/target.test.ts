import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveCheckTarget } from "../../../cli/pr-walkthrough/target";

const eventFile = (payload: unknown): string => {
  const path = join(mkdtempSync(join(tmpdir(), "muggle-event-")), "event.json");
  writeFileSync(path, JSON.stringify(payload));
  return path;
};

const ghReturning = (headSha: string) => (): string => headSha;

describe("resolveCheckTarget", () => {
  it("reads the PR and head sha straight off a pull_request event", () => {
    const env = {
      GITHUB_REPOSITORY: "o/r",
      GITHUB_EVENT_PATH: eventFile({ pull_request: { number: 7, head: { sha: "deadbee" } } }),
    };
    expect(resolveCheckTarget({}, env, ghReturning("unused"))).toEqual({
      repo: "o/r",
      prNumber: 7,
      headSha: "deadbee",
      publishCheckRun: false,
    });
  });

  // An issue_comment payload carries no head sha, and its job runs on the
  // default branch — so the sha the check run must target has to be fetched.
  it("fetches the head sha for a comment event, which carries none", () => {
    const env = {
      GITHUB_REPOSITORY: "o/r",
      GITHUB_EVENT_PATH: eventFile({ issue: { number: 12, pull_request: {} } }),
    };
    expect(resolveCheckTarget({}, env, ghReturning("cafe123\n"))?.headSha).toBe("cafe123");
  });

  it("prefers explicit flags over the event payload", () => {
    const env = {
      GITHUB_REPOSITORY: "o/r",
      GITHUB_EVENT_PATH: eventFile({ pull_request: { number: 7, head: { sha: "deadbee" } } }),
    };
    const target = resolveCheckTarget(
      { repo: "other/repo", pr: "42", headSha: "beefbee", checkRun: true },
      env,
      ghReturning("unused"),
    );
    expect(target).toEqual({
      repo: "other/repo",
      prNumber: 42,
      headSha: "beefbee",
      publishCheckRun: true,
    });
  });

  it("resolves nothing without a repo", () => {
    expect(resolveCheckTarget({ pr: "7" }, {}, ghReturning("x"))).toBeNull();
  });

  it("resolves nothing for an issue comment that is not on a PR", () => {
    const env = {
      GITHUB_REPOSITORY: "o/r",
      GITHUB_EVENT_PATH: eventFile({ issue: { number: 12 } }),
    };
    expect(resolveCheckTarget({}, env, ghReturning("x"))).toBeNull();
  });
});
