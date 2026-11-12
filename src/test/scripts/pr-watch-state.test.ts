/**
 * Behavioral coverage for the watch loop's state projection.
 *
 * The projection used to live inline inside `pr-watch-loop.sh`'s `gh api --jq`
 * argument, where no test could reach it. That is how the loop came to wake on
 * its own replies: posting a threaded reply mints both a comment and a review
 * envelope around it, and the floors were bare maxima over ids with no notion
 * of who authored what. Extracting the filter is what makes that reachable.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const toBash = (p: string) => p.replace(/\\/g, "/");

const filterPath = toBash(
  fileURLToPath(new URL("../../../plugin/scripts/pr-watch-state.jq", import.meta.url)),
);
const loopPath = fileURLToPath(new URL("../../../plugin/scripts/pr-watch-loop.sh", import.meta.url));

const fetchPath = fileURLToPath(new URL("../../../plugin/scripts/pr-watch-fetch.sh", import.meta.url));

const armPath = fileURLToPath(new URL("../../../plugin/scripts/pr-watch-arm.sh", import.meta.url));

let hasJq = false;
try {
  execFileSync("jq", ["--version"], { stdio: "ignore" });
  hasJq = true;
} catch {
  // jq unavailable — the suite below skips
}

const LOOP_MARKER = "<!-- muggle-do:bot -->";

enum Field {
  State = 0,
  HeadOid = 1,
  BaseTip = 2,
  Mergeable = 3,
  LatestReview = 4,
  LatestComment = 5,
  ThreadIds = 6,
  PendingChecks = 7,
  FailedChecks = 8,
  CheckDigest = 9,
  RedCheckRuns = 10,
  LatestConversationComment = 11,
  BodyOnlyReviewIds = 12,
  ConversationCommentIds = 13,
  UnansweredThreadComments = 14,
}

const STATE_FIELD_COUNT = 15;

interface ReviewFixture {
  databaseId: number;
  body: string;
  state?: string;
  lineCommentCount?: number;
}

interface ConversationCommentFixture {
  databaseId: number;
  body: string;
  authorLogin?: string;
  authorType?: string;
}

interface ThreadFixture {
  id: string;
  isResolved?: boolean;
  isOutdated?: boolean;
  commentId: number;
  body: string;
  reviewId: number;
  reviewState?: string;
}

// `baseRef` is the base branch itself; null is what GitHub returns once that
// branch is gone.
function snapshot(
  reviews: ReviewFixture[],
  threads: ThreadFixture[],
  contexts: unknown[] = [],
  baseRef: { target: { oid: string } } | null = { target: { oid: "ccc" } },
  conversationComments: ConversationCommentFixture[] = [],
): string {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          state: "OPEN",
          headRefOid: "aaa",
          baseRefOid: "bbb",
          baseRef: baseRef,
          mergeable: "MERGEABLE",
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: contexts } } } }] },
          reviews: {
            nodes: reviews.map((review) => ({
              databaseId: review.databaseId,
              body: review.body,
              state: review.state ?? "COMMENTED",
              comments: { totalCount: review.lineCommentCount ?? 0 },
            })),
          },
          reviewThreads: {
            nodes: threads.map((thread) => ({
              id: thread.id,
              isResolved: thread.isResolved ?? false,
              isOutdated: thread.isOutdated ?? false,
              comments: {
                nodes: [
                  {
                    databaseId: thread.commentId,
                    body: thread.body,
                    pullRequestReview: {
                      databaseId: thread.reviewId,
                      state: thread.reviewState ?? "COMMENTED",
                    },
                  },
                ],
              },
            })),
          },
          comments: {
            nodes: conversationComments.map((comment) => ({
              databaseId: comment.databaseId,
              body: comment.body,
              createdAt: "2026-11-03T00:00:00Z",
              author: { __typename: comment.authorType ?? "User", login: comment.authorLogin ?? "reviewer" },
            })),
          },
        },
      },
    },
  });
}

// jq on Windows terminates lines with CRLF, so a stray \r would make every
// trailing field compare unequal.
function project(input: string): string[] {
  const rendered = execFileSync("jq", ["-r", "-f", filterPath], {
    input: input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return rendered.replace(/\r/g, "").replace(/\n$/, "").split("\t");
}

describe.skipIf(!hasJq)("pr-watch-state projection", () => {
  const humanComment = "this leaks a handle";
  const loopReply = `${LOOP_MARKER}\nAddressed in abc1234: fixed.`;

  it("keeps a human comment and its review in the floors", () => {
    const fields = project(
      snapshot(
        [{ databaseId: 300, body: "" }],
        [{ id: "T1", commentId: 13, body: humanComment, reviewId: 300 }],
      ),
    );
    expect(fields[Field.LatestComment]).toBe("13");
    expect(fields[Field.LatestReview]).toBe("300");
  });

  // The echo the extraction exists to kill: the loop answered, and neither the
  // reply nor the envelope minted around it may read as something new.
  it("excludes the loop's own reply from the comment floor", () => {
    const fields = project(
      snapshot(
        [{ databaseId: 100, body: "" }],
        [{ id: "T1", commentId: 11, body: loopReply, reviewId: 200 }],
      ),
    );
    expect(fields[Field.LatestComment]).toBe("0");
  });

  it("excludes the review envelope minted around the loop's reply", () => {
    const fields = project(
      snapshot(
        [
          { databaseId: 100, body: "" },
          { databaseId: 200, body: "" },
        ],
        [{ id: "T1", commentId: 11, body: loopReply, reviewId: 200 }],
      ),
    );
    expect(fields[Field.LatestReview]).toBe("100");
  });

  // Only a review whose every live comment is the loop's counts as an echo. One
  // that also carries human feedback is real work and must still wake the loop.
  it("keeps a review that owns human feedback as well as a loop reply", () => {
    const fields = project(
      snapshot(
        [{ databaseId: 400, body: "" }],
        [
          { id: "T1", commentId: 11, body: loopReply, reviewId: 400 },
          { id: "T2", commentId: 12, body: humanComment, reviewId: 400 },
        ],
      ),
    );
    expect(fields[Field.LatestReview]).toBe("400");
    expect(fields[Field.LatestComment]).toBe("12");
  });

  it("keeps a review carrying a body of its own", () => {
    const fields = project(
      snapshot(
        [{ databaseId: 500, body: "please rework the naming" }],
        [{ id: "T1", commentId: 11, body: loopReply, reviewId: 500 }],
      ),
    );
    expect(fields[Field.LatestReview]).toBe("500");
  });

  it("ignores a draft review's comments", () => {
    const fields = project(
      snapshot(
        [{ databaseId: 300, body: "" }],
        [{ id: "T1", commentId: 13, body: humanComment, reviewId: 300, reviewState: "PENDING" }],
      ),
    );
    expect(fields[Field.LatestComment]).toBe("0");
  });

  it("ignores a resolved thread", () => {
    const fields = project(
      snapshot(
        [{ databaseId: 300, body: "" }],
        [{ id: "T1", commentId: 13, body: humanComment, reviewId: 300, isResolved: true }],
      ),
    );
    expect(fields[Field.LatestComment]).toBe("0");
    expect(fields[Field.ThreadIds]).toBe("");
  });

  it("lists unresolved thread ids and rolls the checks up", () => {
    const fields = project(
      snapshot(
        [{ databaseId: 300, body: "" }],
        [{ id: "T1", commentId: 13, body: humanComment, reviewId: 300 }],
        [
          { __typename: "CheckRun", name: "ci", status: "COMPLETED", conclusion: "FAILURE" },
          { __typename: "CheckRun", name: "lint", status: "IN_PROGRESS", conclusion: null },
        ],
      ),
    );
    expect(fields[Field.ThreadIds]).toBe("T1");
    expect(fields[Field.PendingChecks]).toBe("1");
    expect(fields[Field.FailedChecks]).toBe("1");
    expect(fields[Field.CheckDigest]).toBe("ci:FAILURE,lint:PENDING");
  });

  // A settle or rerun publishes a new run on the same head; the run id is what
  // tells its verdict from the one already reported.
  it("names each failed check with its run id, sorted", () => {
    const fields = project(
      snapshot(
        [],
        [],
        [
          { __typename: "CheckRun", databaseId: 92, name: "muggle-walkthrough", status: "COMPLETED", conclusion: "FAILURE" },
          { __typename: "CheckRun", databaseId: 41, name: "build", status: "COMPLETED", conclusion: "TIMED_OUT" },
          { __typename: "CheckRun", databaseId: 17, name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
          { __typename: "StatusContext", context: "deploy", state: "ERROR" },
        ],
      ),
    );
    expect(fields[Field.RedCheckRuns]).toBe("build#41,deploy#,muggle-walkthrough#92");
    expect(fields[Field.CheckDigest]).toBe("build:TIMED_OUT,deploy:ERROR,lint:SUCCESS,muggle-walkthrough:FAILURE");
  });

  // The loop reads these positionally, so a field added anywhere but the end
  // silently shifts every reader after it.
  it("emits exactly the fields the loop reads positionally", () => {
    const fields = project(
      snapshot(
        [{ databaseId: 300, body: "" }],
        [{ id: "T1", commentId: 13, body: humanComment, reviewId: 300 }],
      ),
    );
    expect(fields).toHaveLength(STATE_FIELD_COUNT);
  });

  // baseRefOid ("bbb") only moves when the head is pushed, so a rebase key built
  // from it never notices the base branch advancing.
  it("projects the base branch tip, not the base recorded at the last push", () => {
    expect(project(snapshot([], []))[Field.BaseTip]).toBe("ccc");
  });

  it("keeps the base tip's slot when the base branch is gone", () => {
    const fields = project(snapshot([], [], [], null));
    expect(fields).toHaveLength(STATE_FIELD_COUNT);
    expect(fields[Field.BaseTip]).toBe("");
    expect(fields[Field.Mergeable]).toBe("MERGEABLE");
  });

  describe("latest conversation comment", () => {
    const latestConversation = (comments: ConversationCommentFixture[]): string =>
      project(snapshot([], [], [], { target: { oid: "ccc" } }, comments))[Field.LatestConversationComment];

    it("is the newest top-level comment a human wrote", () => {
      expect(
        latestConversation([
          { databaseId: 70, body: "can you rename this?" },
          { databaseId: 71, body: "also the docs" },
        ]),
      ).toBe("71");
    });

    it("is zero on a PR with no conversation comments", () => {
      expect(latestConversation([])).toBe("0");
    });

    it.each([
      ["a loop reply", `${LOOP_MARKER}\nRe: comment #70 — addressed in abc1234.`],
      ["a PR section", "<!-- muggle-pr-section:v1 -->\n## E2E"],
      ["a walkthrough", "<!-- muggle-pr-walkthrough:v1 -->\nresults"],
      ["a skipped-walkthrough settle", "<!-- muggle-pr-walkthrough-status:skipped -->\nskipped"],
      ["a description-style signature", "<!-- muggle-works:signature -->\nbody"],
      [
        "a plain-signed notice",
        "done\n\n🤖 _Posted by `/muggle-do` · [Muggle Works](https://github.com/multiplex-ai/muggle-ai-works)_",
      ],
    ])("ignores %s", (_label, body) => {
      expect(latestConversation([{ databaseId: 70, body: "please fix" }, { databaseId: 80, body: body }])).toBe("70");
    });

    it.each([
      ["a GraphQL Bot", { authorType: "Bot", authorLogin: "github-actions" }],
      ["a [bot] login", { authorLogin: "dependabot[bot]" }],
      ["github-actions", { authorLogin: "github-actions" }],
    ])("ignores %s author", (_label, author) => {
      expect(
        latestConversation([{ databaseId: 70, body: "please fix" }, { databaseId: 80, body: "deploy ok", ...author }]),
      ).toBe("70");
    });

    // Quote-reply copies the quoted markdown, signature link included.
    it("keeps a human reply quoting one of muggle's posts", () => {
      const quotedReply =
        "> done\n> 🤖 _Posted by `/muggle-do` · [Muggle Works](https://github.com/multiplex-ai/muggle-ai-works)_\n\nthat broke the build";
      expect(latestConversation([{ databaseId: 90, body: quotedReply }])).toBe("90");
    });
  });

  // The arm step checks each list against what last_seen.json records as
  // handled, so muggle's own posts must never appear in one.
  describe("feedback lists for the arm step", () => {
    it("lists body-only reviews, skipping line-comment, empty, dismissed and muggle-signed ones", () => {
      const fields = project(
        snapshot(
          [
            { databaseId: 41, body: "please split this" },
            { databaseId: 42, body: "", lineCommentCount: 0 },
            { databaseId: 43, body: "see inline", lineCommentCount: 2 },
            { databaseId: 44, body: "old", state: "DISMISSED" },
            { databaseId: 45, body: "<!-- muggle-works:signature -->\nnotice" },
            { databaseId: 39, body: "lgtm with a nit", state: "APPROVED" },
          ],
          [],
        ),
      );
      expect(fields[Field.BodyOnlyReviewIds]).toBe("39,41");
    });

    it("lists human conversation comments, skipping muggle's signed replies and bots", () => {
      const fields = project(
        snapshot([], [], [], { target: { oid: "ccc" } }, [
          { databaseId: 6809364360, body: "can you also cover the retry path?" },
          { databaseId: 6809364400, body: "<!-- muggle-works:signature -->\nAddressed in abc1234." },
          { databaseId: 6809364500, body: "deploy ok", authorType: "Bot", authorLogin: "github-actions" },
          { databaseId: 6809364300, body: "first look" },
        ]),
      );
      expect(fields[Field.ConversationCommentIds]).toBe("6809364300,6809364360");
    });

    // Outdatedness is not a gate on the tick's actionable threads, so it is not one here.
    it("pairs each unanswered thread's newest comment with its review, outdated threads included", () => {
      const fields = project(
        snapshot(
          [],
          [
            { id: "T1", commentId: 112, body: humanComment, reviewId: 57 },
            { id: "T2", commentId: 113, body: humanComment, reviewId: 58, isOutdated: true },
            { id: "T3", commentId: 114, body: loopReply, reviewId: 59 },
            { id: "T4", commentId: 115, body: humanComment, reviewId: 60, isResolved: true },
            { id: "T5", commentId: 116, body: humanComment, reviewId: 61, reviewState: "PENDING" },
          ],
        ),
      );
      expect(fields[Field.UnansweredThreadComments]).toBe("112:57,113:58");
    });
  });

  // The read moved into pr-watch-fetch.sh so the arm step and the loop see the
  // PR through one projection. A watermark seeded through a different shape than
  // the one it is later compared against is worse than no watermark at all.
  it("is the filter the shared fetch actually loads", () => {
    const fetchBody = readFileSync(fetchPath, "utf8");
    expect(fetchBody).toContain('--jq "$state_projection"');
  });

  it("is loaded by both readers through that one library", () => {
    const loopBody = readFileSync(loopPath, "utf8");
    const armBody = readFileSync(armPath, "utf8");

    [loopBody, armBody].forEach((body) => {
      expect(body).toContain("pr-watch-state.jq");
      expect(body).toContain("pr-watch-fetch.sh");
      expect(body).toContain("watch_fetch_state");
    });
  });
});
