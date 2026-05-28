# Per-skill optimization log

Each entry: the genuine routing miss from the baseline, the description change, and the targeted re-run that confirms the fix with no new collisions. One stacked PR per skill.

## muggle-feedback

**Baseline miss:** "here's the dashboard link https://app.muggle.dev/runs/abc123 — the script is broken at the submit step" routed to `systematic-debugging` ×5 (a Muggle run critique read as a debugging task).

**Change:** reframed the description around *flagging that a generated Muggle script/step did the wrong thing* and explicitly claimed dashboard-URL-plus-what-failed reports, so it beats generic debugging while staying scoped to Muggle-generated scripts.

**Re-run (8/8):** failing query → `muggle-feedback` ×3; all 4 other feedback positives still pass; near-misses stay clean (resume → none; "fix the broken webpack build" and "flaky CI test" → `systematic-debugging`, i.e. no muggle skill over-triggers).

## muggle-test

**Baseline miss:** "validate my changes before I open the PR" routed to `verification-before-completion` ×5 — a superpowers process skill owns "before creating PRs."

**Change:** the automated optimizer's full rewrite failed (split across superpowers skills, and it regressed "regression test my work"). Hand-authored instead: kept the original's broad change-driven coverage and added an explicit clause that the pre-PR/merge acceptance gate ("validate my changes before I open the PR") means *run the acceptance suite, not just a completion checklist*, plus a `muggle-test-feature-local` boundary pointer.

**Re-run (9/9, 5×):** contested query → `muggle-test` 5/5; "regression test my work" still passes; `muggle-test-feature-local` and `muggle-pr-visual-walkthrough` siblings unaffected; "run the full test suite with npm test" → none.
