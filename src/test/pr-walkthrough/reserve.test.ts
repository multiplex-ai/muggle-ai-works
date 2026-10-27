import { describe, it, expect } from "vitest";
import {
  isWalkthroughSettledOnPr,
  noteWalkthroughRerunStarted,
  reserveWalkthroughComment,
  settleWalkthroughCommentAsSkipped,
  settleWalkthroughCommentAsUnreasoned,
  settleWalkthroughCommentForNoAppLogicChange,
} from "../../pr-walkthrough/reserve";
import { renderReservedComment, renderSkippedComment, withRerunNotice } from "../../pr-walkthrough/comment";
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

describe("isWalkthroughSettledOnPr", () => {
  it("is settled by a posted walkthrough or a settled skip", () => {
    expect(isWalkthroughSettledOnPr(PR_URL, recorder({ "issues/7/comments": listedComments(["<!-- muggle-pr-section:v1 -->"]) }).run)).toBe(true);
    const skipped = `${WALKTHROUGH_SLOT_MARKER}\n${WALKTHROUGH_SKIPPED_MARKER}\nE2E did not run`;
    expect(isWalkthroughSettledOnPr(PR_URL, recorder({ "issues/7/comments": listedComments([skipped]) }).run)).toBe(true);
  });

  it("is not settled by the reserved placeholder, nor when the comments cannot be read", () => {
    expect(isWalkthroughSettledOnPr(PR_URL, recorder({ "issues/7/comments": listedComments([renderReservedComment()]) }).run)).toBe(false);
    expect(isWalkthroughSettledOnPr(PR_URL, () => null)).toBe(false);
    expect(isWalkthroughSettledOnPr("https://example.com/not-a-pr", recorder({}).run)).toBe(false);
  });
});

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

describe("settleWalkthroughCommentForNoAppLogicChange", () => {
  const DETAIL = "1a2b3c4 README typo";
  const NEW_HEAD = "9f8e7d6c5b4a39281706f5e4d3c2b1a098f7e6d5";
  const WALKTHROUGH = "<!-- muggle-pr-section:v1 -->\n## E2E Acceptance Results\n\n**✅ PASS** — 3 tests ran";
  const OVERFLOW = "<!-- muggle-pr-section:v1 -->\n## E2E acceptance evidence (overflow)";
  const patchedBody = (calls: RecordedCall[]): string =>
    JSON.parse(calls.find((call) => call.args.includes("PATCH"))?.input ?? "{}").body ?? "";

  // The common watcher case: the slot already holds an earlier full run.
  it("rewrites a posted walkthrough as skipped for the new head, keeping the run underneath", () => {
    const gh = recorder({
      "issues/7/comments": listedComments(["looks good", WALKTHROUGH, OVERFLOW]),
      "pulls/7": `${NEW_HEAD}\n`,
    });
    expect(settleWalkthroughCommentForNoAppLogicChange(PR_URL, DETAIL, gh.run)).toBe(true);
    const patched = gh.calls.filter((call) => call.args.includes("PATCH"));
    expect(patched).toHaveLength(1);
    expect(patched[0].args.join(" ")).toContain("issues/comments/2");
    const body = patchedBody(gh.calls);
    expect(body).toContain(WALKTHROUGH_SKIPPED_MARKER);
    expect(body).toContain("no app-logic change in `9f8e7d6`");
    expect(body).toContain("README typo");
    expect(body).toContain("**✅ PASS** — 3 tests ran");
    expect(body).not.toContain("muggle-pr-section");
  });

  it("settles a reserved slot that never held a run", () => {
    const gh = recorder({ "issues/7/comments": listedComments([renderReservedComment()]), "pulls/7": NEW_HEAD });
    expect(settleWalkthroughCommentForNoAppLogicChange(PR_URL, DETAIL, gh.run)).toBe(true);
    expect(patchedBody(gh.calls)).toContain("No full E2E run is on record");
  });

  it("hands an earlier skip's carried run on to the next one", () => {
    const first = recorder({ "issues/7/comments": listedComments([WALKTHROUGH]), "pulls/7": NEW_HEAD });
    settleWalkthroughCommentForNoAppLogicChange(PR_URL, DETAIL, first.run);
    const second = recorder({ "issues/7/comments": listedComments([patchedBody(first.calls)]), "pulls/7": NEW_HEAD });
    expect(settleWalkthroughCommentForNoAppLogicChange(PR_URL, "9f8e7d6 lint config", second.run)).toBe(true);
    const body = patchedBody(second.calls);
    expect(body).toContain("**✅ PASS** — 3 tests ran");
    expect(body.match(/Last full E2E run on this PR/g)).toHaveLength(1);
  });

  it("posts the notice when the PR has no designated comment", () => {
    const gh = recorder({ "issues/7/comments": listedComments(["hi"]), "pulls/7": NEW_HEAD });
    expect(settleWalkthroughCommentForNoAppLogicChange(PR_URL, DETAIL, gh.run)).toBe(true);
    const posted = gh.calls.find((call) => call.args.includes("POST"));
    expect(posted?.input).toContain(WALKTHROUGH_SLOT_MARKER);
  });

  it("makes no provider call for a detail that names no commit", () => {
    const gh = recorder({});
    expect(settleWalkthroughCommentForNoAppLogicChange(PR_URL, "docs only", gh.run)).toBe(false);
    expect(gh.calls).toEqual([]);
  });
});

describe("noteWalkthroughRerunStarted", () => {
  const WALKTHROUGH = "<!-- muggle-pr-section:v1 -->\n## E2E Acceptance Results\n\n**⚠️ PARTIAL** — 1 test ran";
  const STARTED_AT = new Date("2026-10-27T05:12:40Z");
  const patchedBody = (calls: RecordedCall[]): string =>
    JSON.parse(calls.find((call) => call.args.includes("PATCH"))?.input ?? "{}").body ?? "";

  it("puts the banner on the posted walkthrough and keeps the walkthrough under it", () => {
    const gh = recorder({ "issues/7/comments": listedComments(["looks good", WALKTHROUGH]) });
    expect(noteWalkthroughRerunStarted(PR_URL, gh.run, STARTED_AT)).toBe(true);
    const patched = gh.calls.filter((call) => call.args.includes("PATCH"));
    expect(patched).toHaveLength(1);
    expect(patched[0].args.join(" ")).toContain("issues/comments/2");
    const body = patchedBody(gh.calls);
    expect(body).toContain("A new E2E run is in progress");
    expect(body).toContain("2026-10-27 05:12 UTC");
    expect(body.endsWith(WALKTHROUGH)).toBe(true);
  });

  it("banners a skipped comment too, since the run will replace it", () => {
    const skipped = renderSkippedComment(E2eSkipCode.NotApplicable, "only the email template changed");
    const gh = recorder({ "issues/7/comments": listedComments([skipped]) });
    expect(noteWalkthroughRerunStarted(PR_URL, gh.run, STARTED_AT)).toBe(true);
    expect(patchedBody(gh.calls)).toContain(WALKTHROUGH_SKIPPED_MARKER);
  });

  // Every execution in a run fires the hook; only the first may write.
  it("leaves a comment that already carries the banner alone", () => {
    const gh = recorder({ "issues/7/comments": listedComments([withRerunNotice(WALKTHROUGH, STARTED_AT)]) });
    expect(noteWalkthroughRerunStarted(PR_URL, gh.run, new Date("2026-10-27T05:40:00Z"))).toBe(false);
    expect(gh.calls.some((call) => call.args.includes("PATCH"))).toBe(false);
  });

  it("leaves the reserved placeholder alone, which already says a run is awaited", () => {
    const gh = recorder({ "issues/7/comments": listedComments([renderReservedComment()]) });
    expect(noteWalkthroughRerunStarted(PR_URL, gh.run, STARTED_AT)).toBe(false);
    expect(gh.calls.some((call) => call.args.includes("PATCH"))).toBe(false);
  });

  it("posts nothing on a PR without a designated comment", () => {
    const gh = recorder({ "issues/7/comments": listedComments(["looks good"]) });
    expect(noteWalkthroughRerunStarted(PR_URL, gh.run, STARTED_AT)).toBe(false);
    expect(gh.calls.some((call) => call.args.includes("POST") || call.args.includes("PATCH"))).toBe(false);
  });

  it("fails open when the comments cannot be read or the url is not a PR", () => {
    expect(noteWalkthroughRerunStarted(PR_URL, () => null, STARTED_AT)).toBe(false);
    const gh = recorder({});
    expect(noteWalkthroughRerunStarted("https://github.com/o/r/issues/7", gh.run, STARTED_AT)).toBe(false);
    expect(gh.calls).toEqual([]);
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
