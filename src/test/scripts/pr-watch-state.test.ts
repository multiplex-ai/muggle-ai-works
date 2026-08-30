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
  BaseOid = 2,
  Mergeable = 3,
  LatestReview = 4,
  LatestComment = 5,
  ThreadIds = 6,
  PendingChecks = 7,
  FailedChecks = 8,
  CheckDigest = 9,
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

function snapshot(
  reviews: Array<{ databaseId: number; body: string }>,
  threads: ThreadFixture[],
  contexts: unknown[] = [],
): string {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          state: "OPEN",
          headRefOid: "aaa",
          baseRefOid: "bbb",
          mergeable: "MERGEABLE",
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: contexts } } } }] },
          reviews: { nodes: reviews },
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

  // The loop reads these positionally, so a field added anywhere but the end
  // silently shifts every reader after it.
  it("emits exactly the ten fields the loop reads positionally", () => {
    const fields = project(
      snapshot(
        [{ databaseId: 300, body: "" }],
        [{ id: "T1", commentId: 13, body: humanComment, reviewId: 300 }],
      ),
    );
    expect(fields).toHaveLength(10);
  });

  // The read moved into pr-watch-fetch.sh so the arm step and the loop see the
  // PR through one projection. A watermark seeded through a different shape than
  // the one it is later compared against is worse than no watermark at all.
  it("is the filter the shared fetch actually loads", () => {
    const fetchBody = execFileSync("cat", [toBash(fetchPath)], { encoding: "utf8" });
    expect(fetchBody).toContain('--jq "$state_projection"');
  });

  it("is loaded by both readers through that one library", () => {
    const loopBody = execFileSync("cat", [toBash(loopPath)], { encoding: "utf8" });
    const armBody = execFileSync("cat", [toBash(armPath)], { encoding: "utf8" });

    [loopBody, armBody].forEach((body) => {
      expect(body).toContain("pr-watch-state.jq");
      expect(body).toContain("pr-watch-fetch.sh");
      expect(body).toContain("watch_fetch_state");
    });
  });
});
