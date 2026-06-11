# Opus 4.8 re-validation

Re-ran the routing eval against `claude-opus-4-8` (the prior baseline in `final.md` was on opus-4-6) across all 14 auto-trigger skills. The family still routes correctly; one description was improved and one harness bug fixed.

## Method

`run.py` routes via the *installed* plugin cache. Master's auto-trigger descriptions are byte-identical to installed 5.0.4 for all 14 eval skills (only `muggle-do` differs, and it is explicit-only / out of scope), so the triage measured master directly. Description edits were validated by syncing the working-tree `SKILL.md` into the cache and re-running.

## Triage (runs=1, full set)

374/391 = **95.7%**. Negatives **48/48** — no muggle skill over-triggered. All 17 misses were under-triggers.

runs=1 is noisy, so every flagged skill was re-confirmed at runs=3 (majority vote):

| skill | runs=1 | runs=3 | verdict |
|---|---|---|---|
| muggle-browser-task | 17/25 | **20/25** | genuine systematic gap → fixed below |
| muggle-repair | 21/24 | **24/24** | runs=1 "→status" misses were noise; no change |
| muggle-feedback | 21/24 | **23/24** | runs=1 "→systematic-debugging" misses were noise; no change |
| muggle-status | 24/24 | 24/24 | clean |
| muggle | 22/24 | — | `/muggle`→none (noise) + one deliberately-ambiguous query; no change |
| muggle-pr-followup | 23/24 | — | one loss to `muggle-do`; well above its documented best-effort ceiling (the `loop` collision); no change |

The other eight skills were 100% at runs=1 (pr-visual-walkthrough, preferences, test, test-feature-local, test-import, test-prepare, regenerate-missing, upgrade).

## The one fix: muggle-browser-task

"Log into X and do Y" action requests routed to `none` — the model attempts or declines the task itself instead of invoking the skill. The original description was the thinnest of the real skills (322 ch) and named neither the user's verbs nor the model's failure mode.

**Triggering here is high-variance.** Across four runs of near-identical pushier wording, recall swung 21–25/25 — these queries sit exactly on the model's invoke-or-act-directly boundary, so the number is noise-dominated (the dispositional floor for do-the-task skills; wording is a weak lever at this margin). The mean still beats the 20/25 baseline, so a pushier, more concrete description helps — it just cannot stably pin 25/25.

Precision is the real constraint: listing "Slack" / "send a message" as triggers collided with the negative "ping the team on slack to review my PR" (a PR-coordination ask), which over-fired browser-task — more disruptive than an under-trigger. The shipped wording leads with transactional verbs and sites (submit the form, place the order, refund the charge, file the ticket, publish a post; Stripe, Jira, Shopify, the AWS console, WordPress, LinkedIn), pushes against declining, and drops the chat framing.

**Result (runs=3, browser-task + 48 negatives):** browser-task **24/25** (was 20/25), negatives **48/48** clean. The single remaining miss — a Slack-channel message — is a deliberate trade to keep negatives clean; explicit `/mbt` remains the reliable path for that case.

## Harness fix

`run.py`'s `REPO_ROOT = HERE.parents[2]` resolved to the repo's *parent*, so the documented `run.py --all --sync-cache` (no explicit `--repo-root`) silently synced 0 descriptions and tested the installed copy instead of the edit. Corrected to `parents[1]`.

## Net

14/14 skills route correctly; negatives 48/48 clean. One description improved (browser-task 80%→96%), one harness bug fixed. The "wording is a weak lever for action/test skills" finding holds — browser-task is the only description that moved, and only modestly.
