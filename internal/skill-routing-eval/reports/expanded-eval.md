# Expanded eval — full run (14 skills, 391 queries)

Complete run of the expanded eval set (supersedes the partial 7-skill report). Per-skill chunked with the disconnect guard; the `muggle-status` chunk uses its post-fix description (#220). Raw per-query data: `expanded-eval.json`.

**Overall muggle-routing accuracy: 356/391 = 91.0%.** Excluding `muggle-pr-followup` (an accepted platform-skill collision, below), the other 13 skills route at **356/367 = 97%**.

## Per-skill recall

| skill | recall | note |
|---|---|---|
| muggle-feedback | 24/24 | |
| muggle-pr-visual-walkthrough | 24/24 | |
| muggle-preferences | 24/24 | |
| muggle-test | 26/26 | |
| muggle-test-feature-local | 26/26 | |
| muggle-test-import | 24/24 | |
| muggle-test-prepare | 24/24 | |
| muggle-test-regenerate-missing | 24/24 | |
| muggle-upgrade | 26/26 | |
| muggle | 23/24 | bare `/muggle` literal → none |
| muggle-repair | 23/24 | "is it broken? fix it" → muggle-status (soft status/repair boundary) |
| muggle-status | 21/24 | post-#220; 3 ultra-terse "just checking, is the MCP reachable?" residuals |
| muggle-do-task | 20/25 | 5 misses below |
| muggle-pr-followup | 0/24 | platform-`loop` collision — see below; #223 lifts it to ~6/24 |

Negative class: **47/48 clean.** One over-fire: "import my Spotify playlist into Apple Music" → muggle-do-task (a cross-service "import…into" that reads like a web action).

## Findings

**muggle-pr-followup vs the built-in `loop` skill (accepted limitation).** Made model-invocable in #218, it routes 0/24 here — every "watch/poll/monitor/babysit my PR" query goes to the platform `loop` skill, whose own examples are "poll for status" and "keep running /babysit-prs". Two description rewrites moved it 0→6→5 with negatives always clean, so it's purely losing the head-to-head, not over-triggering. Resolution (#223): keep it model-invocable, ship the best-routing description, document the collision. `loop` is a reasonable first hop that can run this skill; explicit `/muggle:muggle-pr-followup` always works.

**muggle-do-task (80%).** Five web-automation queries route to `none`: LinkedIn login+post, AWS IAM user creation, Slack message, Stripe refund, prod checkout. These are consequential real-account side effects Claude declines to auto-drive rather than a description gap — partly correct caution, and a labeling question (whether high-consequence account actions belong to do-task at all). Not pursued as a description fix.

**muggle-status (88%, post-#220).** The #220 fix lifted it from 54% → 88% on the full run; 3 residual ultra-terse "just checking" health questions remain borderline. Diminishing returns; left as-is.

**Single soft misses.** bare `/muggle` literal → none; "is muggle broken? fix it" → muggle-status (status/repair boundary). Both acceptable.

## Not a disconnect

The `muggle-pr-followup` chunk reads 0% but routes to `loop` (a real skill), not the all-`none` signature of an MCP disconnect; confirmed stable across re-runs. No suspected-disconnect chunks in this run.
