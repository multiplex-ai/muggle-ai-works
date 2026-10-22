# Cycle size (watcher-dispatched cycles)

Address-reviews, fix-ci, and rebase cycles each run a **minor** or a **full** tail. The diff the cycle produced picks it — never how a review was worded, how many comments asked, or which check was red.

## Starting commit

`pre_cycle_sha` is the PR head the cycle started from, read with `git rev-parse HEAD` in the PR's working tree before the cycle's first change: address-reviews right after its Step 0 sync, fix-ci's `red_sha`, rebase's `rebase_sha`.

## Size

Once the cycle's edits are in the working tree — or the rebase has replayed — run [`impact-analysis.md`](impact-analysis.md) with `pre_cycle_sha`. Its `cycleSize` is:

- **minor** — every path the cycle changed is docs, tests, lint/format config, or CI config, exactly as the `NO_APP_LOGIC_CHANGE` rule in [`e2e-acceptance.md`](e2e-acceptance.md) defines them.
- **full** — anything else, a comment-only or formatting-only edit in a source file included. The rule reads paths, not content, because a path rule is what the guardrail can verify.

A rebase compares trees, so app logic the base brought in makes the rebase full. An empty `cycleFiles` is neither size: the cycle changed nothing (every review was an answerable question), so it runs no tail — no unit run, no push, no declaration — and goes straight to the mode's replies.

## Full tail

Unit tests → E2E per [`e2e-acceptance.md`](e2e-acceptance.md) → push → walkthrough repost: fire [`postPRVisualWalkthrough`](../muggle-preferences/preference-gates/postPRVisualWalkthrough.md), then [`../muggle-pr-visual-walkthrough/SKILL.md`](../muggle-pr-visual-walkthrough/SKILL.md) Mode A → the mode's remaining steps.

## Minor tail

Unit tests → push → declare the skip → the mode's remaining steps. No E2E run, no walkthrough render.

Declare after the push, as one Bash call from the PR's working tree. Only then is local HEAD the head the PR carries: server-signed commits reach the local branch when the push syncs it, and a base sync during the push can rewrite the head.

```bash
echo "MUGGLE_E2E_SKIP: NO_APP_LOGIC_CHANGE: <pre_cycle_sha> <what changed, e.g. README typo, test rename>"
```

- **Accepted** — Muggle rewrites the PR's designated walkthrough comment to "E2E skipped — no app-logic change in `<short-sha>`" with the stated reason, and keeps the last full run's walkthrough collapsed beneath it. The walkthrough check passes on the new head when that run passed. When it failed, the check stays red: commits that changed no app logic cannot have repaired a failing case, so that red is fix-ci's walkthrough repair, never a minor cycle's.
- **Rejected** — the reply names the paths that refuted it. The cycle is full after all: run E2E on the pushed head, repost the walkthrough, then continue.
