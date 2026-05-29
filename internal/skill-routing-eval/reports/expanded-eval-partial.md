# Expanded eval — partial run (7 of 14 skills)

Status: **incomplete.** The expanded 391-case run (~1,092 `claude -p` sessions) hit the account session limit partway through. 7 skills completed (169 queries); the rest (`muggle-test`, `-test-feature-local`, `-test-import`, `-test-prepare`, `-test-regenerate-missing`, `muggle-upgrade`, `muggle-pr-followup`, and the `none` negatives) are queued for a resumed run. Re-run the remaining chunks after the limit resets; see `README.md` for the per-skill chunked recipe.

Partial accuracy on the completed 7: **151/169 = 89.3%**. These misses are interleaved with passes (not a contiguous all-`none` tail), so they are genuine recall gaps, not the MCP-disconnect artifact described in `final.md`.

## Completed skills

| skill | recall | note |
|---|---|---|
| muggle-feedback | 24/24 | clean |
| muggle-pr-visual-walkthrough | 24/24 | clean |
| muggle-preferences | 24/24 | clean |
| muggle | 23/24 | bare `/muggle` → none ×3 |
| muggle-repair | 23/24 | "is it broken? fix it" → muggle-status (status/repair boundary) |
| muggle-do-task | 20/25 | 5 action queries → none |
| muggle-status | 13/24 | **54% — question-phrased health checks → none** |

## New findings (not visible in the 78-case set, which scored these 100%)

1. **muggle-status under-triggers on diagnostic *questions*.** "Is the muggle MCP reachable? just checking", "muggle's been acting up — take a look", "is my muggle login busted?", "why does muggle keep saying it can't connect?" route to `none` — Claude answers conversationally. The description leads with "Check health… / muggle status" and doesn't claim question-shaped "is muggle ok / why is muggle failing" intents. Candidate fix: broaden to own "is muggle working / why is muggle failing / are the MCP tools loading" phrasings.
2. **muggle-do-task misses some real-website actions.** Genuine gaps (LinkedIn post, Slack message) mixed with consequential real-account actions (AWS IAM user, Stripe refund) Claude is reluctant to auto-drive. Worth deciding whether those belong to do-task at all.
3. **muggle-repair vs muggle-status** stays a soft boundary ("is it broken? fix it" leaned status) — acceptable.

Full per-query data: `expanded-eval-partial.json`.
