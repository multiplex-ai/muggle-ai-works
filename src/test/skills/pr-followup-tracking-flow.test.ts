/**
 * Static contract lint for the end-to-end muggle-pr-followup experience — the
 * five steps a user actually sees when they hand a PR to the watcher:
 *
 *   1. init tracking on a PR                         (bootstrap)
 *   2. a comment — or a wave of comments — becomes    (tick, Step 3)
 *      the actionable set
 *   3. decide whether to trigger /muggle-do           (tick, Step 4)
 *      — the watcher is a dumb pipe; the *understanding* lives in /muggle-do
 *   4. after addressing, one reply per comment        (/muggle-do)
 *   5. keep polling until the PR is merged or closed  (tick, Step 2 + respawn)
 *
 * These read the prose contract; they do NOT execute the watcher (that judgment
 * lives in the LLM at runtime). Cadence/interval specifics are intentionally
 * out of scope — the blocked-cron lint owns those. What this guards is the
 * *shape of the experience*: init → detect → trigger → reply → poll-to-terminal,
 * and the watcher/executor split (watcher detects+triggers+polls; /muggle-do
 * understands+fixes+replies+respawns).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILL_DIR = path.join(REPO_ROOT, "plugin", "skills", "muggle-pr-followup");
const DO_DIR = path.join(REPO_ROOT, "plugin", "skills", "do");
const HELPERS_DIR = path.join(
  REPO_ROOT,
  "plugin",
  "skills",
  "_shared",
  "pr-followup-helpers",
);

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(...segments), "utf8");
}

const LOOP_MARKER = "<!-- muggle-do:bot -->";

describe("Step 1 — init tracking on a PR (bootstrap)", () => {
  const bootstrap = read(SKILL_DIR, "bootstrap.md");

  it("takes a GitHub PR URL as its required first argument", () => {
    expect(bootstrap).toMatch(
      /https\?:\/\/github\\\.com\/\[\^\/]\+\/\[\^\/]\+\/pull\/\\d\+/,
    );
    // The URL is what distinguishes bootstrap from a tick — it must be required.
    expect(bootstrap).toMatch(/required/i);
  });

  it("seeds all four session-state files before it arms the watcher", () => {
    const seedStep = bootstrap.slice(bootstrap.indexOf("### Step 7"));
    for (const file of [
      "prs.json",
      "last_seen.json",
      "cron.json",
      "state.md",
    ]) {
      expect(
        seedStep.includes(file),
        `bootstrap Step 7 does not seed ${file}`,
      ).toBe(true);
    }
  });

  it("starts the tracker at tick zero and unblocked", () => {
    expect(bootstrap).toMatch(/idle_tick_count:\s*0/);
    // A fresh tracker has no durable human-block — the blocked object is omitted.
    expect(bootstrap).toMatch(/starts unblocked/i);
  });

  it("dispatches the first watcher as the last action of the turn", () => {
    // Interval is out of scope here; anchor on the dispatch shape, not the cadence.
    expect(bootstrap).toMatch(/\/muggle:muggle-pr-followup <slug> <n>/);
    expect(bootstrap).toMatch(/last action/i);
  });

  it("catches feedback that already exists on the PR (watermark defaults to 0)", () => {
    // The common case: the user left comments, THEN starts tracking. Default
    // lastBodyReviewId = 0 so the first tick picks up existing body-only reviews.
    expect(bootstrap).toMatch(/lastBodyReviewId\s*=\s*0/);
    // Line-comment threads are picked up from live state regardless of the flag.
    expect(bootstrap).toMatch(
      /does \*\*not\*\* affect line-comment threads.*live thread state/s,
    );
  });
});

describe("Step 2 — a comment, or a wave of comments, becomes the actionable set", () => {
  const contract = read(SKILL_DIR, "contract.md");
  const actionableStep = contract.slice(
    contract.indexOf("### Step 3"),
    contract.indexOf("### Step 4"),
  );

  it("derives the trigger from LIVE thread state, not a stored cursor", () => {
    expect(actionableStep).toMatch(
      /current provider state.*not a stored .*cursor/,
    );
    expect(actionableStep).toMatch(/from live thread state/i);
  });

  it("marks a thread actionable only when unresolved, not outdated, and unanswered by the loop", () => {
    expect(actionableStep).toMatch(/isResolved == false/);
    expect(actionableStep).toMatch(/isOutdated == false/);
    expect(actionableStep.includes(LOOP_MARKER)).toBe(true);
  });

  it("classifies by the loop marker, never by the comment author", () => {
    // Classifying by author.login would mis-handle a human reply on a loop
    // thread and re-fire on the loop's own comments.
    expect(actionableStep).toMatch(/never\s+`author\.login`/);
  });

  it("unions two sources — line-comment threads AND body-only reviews", () => {
    expect(actionableStep).toMatch(/two sources, unioned/i);
    expect(actionableStep).toMatch(/\(a\)\s*Actionable threads/i);
    expect(actionableStep).toMatch(/\(b\)\s*Actionable body-only reviews/i);
  });

  it("collapses a wave into the dedup'd union of owning review ids", () => {
    // A wave of N comments on one review is still one dispatch: the watcher
    // decides *that* there is work, /muggle-do re-enumerates the threads.
    expect(actionableStep).toMatch(/dedup'?d union is the dispatch list/i);
    const dispatchStep = contract.slice(
      contract.indexOf("### Step 4"),
      contract.indexOf("### Step 5"),
    );
    expect(dispatchStep).toMatch(/decide \*?that\*? there is work/i);
  });
});

describe("Step 3 — decide whether to trigger /muggle-do (watcher triggers; understanding lives in mdo)", () => {
  const contract = read(SKILL_DIR, "contract.md");
  const addressReviews = read(DO_DIR, "address-reviews.md");

  it("the watcher is a dumb pipe — it dispatches and exits, never classifies/replies/escalates", () => {
    expect(contract).toMatch(
      /does not classify.*post replies.*escalate|does not classify, fix, resolve, rebase, amend requirements, post replies, run cycles, or escalate/s,
    );
  });

  it("a non-empty actionable set dispatches /muggle-do address-reviews", () => {
    const dispatchStep = contract.slice(
      contract.indexOf("### Step 4"),
      contract.indexOf("### Step 5"),
    );
    expect(dispatchStep).toMatch(/actionable set is non-empty.*dispatch/i);
    expect(dispatchStep).toMatch(
      /\/muggle-do address reviews .* on <pr-url> slug=<slug>/,
    );
  });

  it("reviews preempt CI — feedback is handled before the branch/CI checks", () => {
    const dispatchStep = contract.slice(
      contract.indexOf("### Step 4"),
      contract.indexOf("### Step 5"),
    );
    expect(dispatchStep).toMatch(/[Rr]eviews preempt CI/);
    // Ordering invariant: the dispatch step precedes the branch/CI steps.
    expect(contract.indexOf("### Step 4")).toBeLessThan(
      contract.indexOf("### Step 5"),
    );
    expect(contract.indexOf("### Step 5")).toBeLessThan(
      contract.indexOf("### Step 6"),
    );
  });

  it("single-thread: the watcher stops its own cron before dispatch so no tick overlaps a cycle", () => {
    const dispatchStep = contract.slice(
      contract.indexOf("### Step 4"),
      contract.indexOf("### Step 5"),
    );
    expect(dispatchStep).toMatch(/Stop this watcher \(single-thread\)/i);
    expect(dispatchStep).toMatch(/respawns the watcher/i);
  });

  it("the *understanding* (actionable vs ambiguous) is /muggle-do's job, and ambiguous escalates to the user", () => {
    expect(addressReviews).toMatch(/### Step 2 — Classify each review/);
    expect(addressReviews).toMatch(/actionable_review_ids/);
    expect(addressReviews).toMatch(/ambiguous_review_ids/);
    // Ambiguous is not silently dropped — it is escalated for the user to clarify.
    const ambiguousStep = addressReviews.slice(
      addressReviews.indexOf("### Step 3 — Handle ambiguous"),
      addressReviews.indexOf("### Step 4 — Handle actionables"),
    );
    expect(ambiguousStep).toMatch(/escalat/i);
    expect(ambiguousStep).toMatch(/user clarifies on GitHub/i);
  });
});

describe("Step 4 — after addressing, reply per comment", () => {
  const addressReviews = read(DO_DIR, "address-reviews.md");
  const perCommentReplies = read(DO_DIR, "per-comment-replies.md");
  const contract = read(SKILL_DIR, "contract.md");

  it("address-reviews posts replies via the per-comment step after the push", () => {
    expect(addressReviews).toMatch(/per-comment-replies\.md/);
    const replyStep = addressReviews.slice(
      addressReviews.indexOf("4f"),
    );
    expect(replyStep).toMatch(/One reply per comment|reply per comment/i);
  });

  it("each comment gets its own threaded reply — never a single per-review summary", () => {
    expect(perCommentReplies).toMatch(/One reply per line comment/);
    expect(perCommentReplies).toMatch(/No per-review summary reply/i);
  });

  it("every reply carries the loop marker (that is what makes the thread stop being actionable)", () => {
    expect(perCommentReplies.includes(LOOP_MARKER)).toBe(true);
    expect(perCommentReplies).toMatch(/marker.*identifies.*loop-authored/i);
    // Echo protection is intrinsic to the marker — assert the wiring exists.
    expect(fs.existsSync(path.join(HELPERS_DIR, "echo-skip.md"))).toBe(true);
    expect(read(HELPERS_DIR, "echo-skip.md").includes(LOOP_MARKER)).toBe(true);
    // The contract explains why: once the loop replies, the thread's newest
    // comment is the loop's own, so it drops out of the next tick's set.
    expect(contract).toMatch(/marker rule makes echo intrinsic/i);
  });

  it("the watcher itself never posts to the PR — replies are strictly /muggle-do's", () => {
    const output = contract.slice(contract.indexOf("## Output"));
    expect(output).toMatch(/never posts to the PR from a tick/);
  });
});

describe("Step 5 — keep polling until the PR is merged or closed", () => {
  const contract = read(SKILL_DIR, "contract.md");
  const addressReviews = read(DO_DIR, "address-reviews.md");
  const respawnWatcher = read(DO_DIR, "respawn-watcher.md");

  it("a merged or closed PR finalizes the slot and stops future ticks", () => {
    const terminationStep = contract.slice(
      contract.indexOf("### Step 2 — Termination check"),
      contract.indexOf("### Step 2.5"),
    );
    expect(terminationStep).toMatch(/MERGED.*CLOSED|MERGED` or `CLOSED/s);
    expect(terminationStep).toMatch(/finalize\.md/i);
    expect(terminationStep).toMatch(/no future ticks fire/i);
  });

  it("an open PR keeps polling — every /muggle-do cycle respawns the watcher unless it went terminal", () => {
    // The respawn is the "keep polling" guarantee: terminal is the ONLY skip.
    expect(respawnWatcher).toMatch(/merged or closed/i);
    expect(respawnWatcher).toMatch(/every.{0,40}exit/i);
    // address-reviews routes its respawn through the shared helper, and every
    // exit path in the cycle lands there — so an open PR is never left un-watched.
    expect(addressReviews).toMatch(/respawn-watcher\.md/);
    const respawnStep = addressReviews.slice(
      addressReviews.indexOf("### Step 6 — Respawn"),
    );
    expect(respawnStep).toMatch(/[Ee]very.*exit path.*lands here/);
    expect(respawnStep).toMatch(/never left un-?watched/i);
  });

  it("an idle tick is not a stop — it re-fires and keeps watching", () => {
    const idleStep = contract.slice(contract.indexOf("### Step 7 — Idle"));
    // A transient idle increments the counter and the next tick fires again.
    expect(idleStep).toMatch(/idle_tick_count/);
    expect(idleStep).toMatch(/next tick fires/i);
  });
});
