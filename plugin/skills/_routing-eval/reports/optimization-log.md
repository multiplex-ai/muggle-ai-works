# Per-skill optimization log

Each entry: the genuine routing miss from the baseline, the description change, and the targeted re-run that confirms the fix with no new collisions. One stacked PR per skill.

## muggle-feedback

**Baseline miss:** "here's the dashboard link https://app.muggle.dev/runs/abc123 — the script is broken at the submit step" routed to `systematic-debugging` ×5 (a Muggle run critique read as a debugging task).

**Change:** reframed the description around *flagging that a generated Muggle script/step did the wrong thing* and explicitly claimed dashboard-URL-plus-what-failed reports, so it beats generic debugging while staying scoped to Muggle-generated scripts.

**Re-run (8/8):** failing query → `muggle-feedback` ×3; all 4 other feedback positives still pass; near-misses stay clean (resume → none; "fix the broken webpack build" and "flaky CI test" → `systematic-debugging`, i.e. no muggle skill over-triggers).
