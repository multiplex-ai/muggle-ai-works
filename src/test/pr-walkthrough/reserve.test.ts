import { describe, it, expect } from "vitest";
import {
  reserveWalkthroughComment,
  settleWalkthroughCommentAsSkipped,
  settleWalkthroughCommentAsUnreasoned,
} from "../../pr-walkthrough/reserve";
import { renderReservedComment } from "../../pr-walkthrough/comment";
import { E2eSkipCode } from "../../e2e-skip/types";
import { WALKTHROUGH_SKIPPED_MARKER, WALKTHROUGH_SLOT_MARKER } from "../../pr-walkthrough/constants";

const PR_URL = "https://github.com/o/r/pull/7";

interface RecordedCall {
  args: string[];
  input?: string;
}

function recorder(responses: Record<string, string>) {
  const calls: RecordedCall[] = [];
  const run = (args: string[], input?: string): string | null => {
    calls.push({ args: args, input: input });
    const matched = Object.entries(responses).find(([fragment]) => args.join(" ").includes(fragment));
    return matched ? matched[1] : "";
  };
  return { calls: calls, run: run };
}

const listedComments = (bodies: string[]): string =>
  JSON.stringify(bodies.map((body, index) => ({ id: index + 1, body: body })));

describe("reserveWalkthroughComment", () => {
  it("posts the reserved body when the PR carries no designated comment", () => {
    const gh = recorder({ "issues/7/comments": listedComments(["looks good"]) });
    expect(reserveWalkthroughComment(PR_URL, gh.run)).toBe(true);
    const posted = gh.calls.find((call) => call.args.includes("--method") && call.args.includes("POST"));
    expect(posted?.input).toContain(WALKTHROUGH_SLOT_MARKER);
  });

  it("does not post a second time when one is already reserved", () => {
    const gh = recorder({ "issues/7/comments": listedComments([renderReservedComment()]) });
    expect(reserveWalkthroughComment(PR_URL, gh.run)).toBe(false);
    expect(gh.calls.some((call) => call.args.includes("POST"))).toBe(false);
  });

  it("leaves a PR that already carries a walkthrough alone", () => {
    const gh = recorder({ "issues/7/comments": listedComments(["<!-- muggle-pr-section:v1 -->\n2 passed"]) });
    expect(reserveWalkthroughComment(PR_URL, gh.run)).toBe(false);
  });

  it("fails open when the provider is unreachable", () => {
    const throwing = (): string | null => {
      throw new Error("gh: not authenticated");
    };
    expect(() => reserveWalkthroughComment(PR_URL, throwing)).not.toThrow();
    expect(reserveWalkthroughComment(PR_URL, throwing)).toBe(false);
  });

  it("ignores a url that is not a pull request", () => {
    const gh = recorder({});
    expect(reserveWalkthroughComment("https://github.com/o/r/issues/7", gh.run)).toBe(false);
    expect(gh.calls).toEqual([]);
  });
});

describe("settleWalkthroughCommentAsSkipped", () => {
  it("patches the designated comment with the verified code", () => {
    const gh = recorder({ "issues/7/comments": listedComments(["hi", renderReservedComment()]) });
    expect(
      settleWalkthroughCommentAsSkipped(PR_URL, E2eSkipCode.NoWebSurface, "hooks and a CLI", gh.run),
    ).toBe(true);
    const patched = gh.calls.find((call) => call.args.includes("PATCH"));
    expect(patched?.args.join(" ")).toContain("issues/comments/2");
    expect(patched?.input).toContain(WALKTHROUGH_SKIPPED_MARKER);
    expect(patched?.input).toContain("NO_WEB_SURFACE");
  });

  it("reserves the slot first when the PR has no designated comment", () => {
    const gh = recorder({ "issues/7/comments": listedComments([]) });
    expect(settleWalkthroughCommentAsSkipped(PR_URL, E2eSkipCode.EmptyDiff, "", gh.run)).toBe(true);
    const posted = gh.calls.find((call) => call.args.includes("POST"));
    expect(posted?.input).toContain("EMPTY_DIFF");
  });

  it("never overwrites a posted walkthrough with a skip", () => {
    const gh = recorder({ "issues/7/comments": listedComments(["<!-- muggle-pr-section:v1 -->\n2 passed"]) });
    expect(settleWalkthroughCommentAsSkipped(PR_URL, E2eSkipCode.EmptyDiff, "", gh.run)).toBe(false);
    expect(gh.calls.some((call) => call.args.includes("PATCH"))).toBe(false);
  });
});

describe("settleWalkthroughCommentAsUnreasoned", () => {
  it("marks the slot as an unreasoned evasion so the release is visible to reviewers", () => {
    const gh = recorder({ "issues/7/comments": listedComments([renderReservedComment()]) });
    expect(settleWalkthroughCommentAsUnreasoned(PR_URL, gh.run)).toBe(true);
    const patched = gh.calls.find((call) => call.args.includes("PATCH"));
    expect(patched?.input).toContain("no verified reason given");
  });
});
