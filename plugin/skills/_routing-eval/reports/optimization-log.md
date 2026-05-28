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

## muggle-test-prepare

**Baseline miss:** "check if localhost:3000 and the api on 8080 are listening before testing" routed to `none` ×3 (fired only 2/5 on re-check) — the port-check phrasing read as a question Claude answers directly.

**Change (optimizer, accepted):** lead with environment readiness and explicitly claim confirming that *specific ports or localhost URLs are listening/up before testing*, with the exact example, and a "not running the tests themselves" boundary.

**Re-run (8/8):** failing query → `muggle-test-prepare` 3/3; all 4 other prepare positives pass; `muggle-test` ("validate before PR", "test on staging") and `muggle-test-feature-local` ("checkout on localhost") siblings unaffected.

---

# Verified-clean entrances (no change needed)

These 11 skills routed at 100% recall with zero false triggers in the baseline. Their entrances are confirmed correct; the description is left unchanged because editing a passing description can only risk regression. One PR each documents the verification.

## muggle — verified 4/4

Router/menu. Fires on bare `muggle` or "what can muggle do"; any specific intent routes straight past it to the matching skill.

## muggle-do-task — verified 5/5

Perform an action on a website (post, fill, submit, click a flow). Distinct from muggle-test-feature-local (verify a flow works) and muggle-test (test code changes).

## muggle-test-feature-local — verified 6/6

Real-browser E2E test of one named feature/flow on localhost. Distinct from muggle-test, which is change-driven over the whole diff before push/PR.

## muggle-test-import — verified 6/6

Bring existing tests/PRDs/specs INTO Muggle. Distinct from muggle-test-regenerate-missing (existing project cases) and from importing a code library.

## muggle-test-regenerate-missing — verified 5/5

Bulk-fill scripts for project test cases that lack one. Distinct from muggle-test-import, which pulls from an external source.

## muggle-pr-visual-walkthrough — verified 5/5

Post existing E2E results/screenshots to a PR. Distinct from muggle-test, which runs the tests.

## muggle-preferences — verified 4/4

View/set/reset Muggle config. Distinct from configuring unrelated tooling (prettier, eslint, git).

## muggle-status — verified 4/4

Health-check/diagnose the Muggle install. Distinct from muggle-repair, which fixes; "is it broken?" leans status.

## muggle-repair — verified 4/4

Fix a broken Muggle install. Distinct from muggle-status (diagnose) and from fixing the user's own app build.
