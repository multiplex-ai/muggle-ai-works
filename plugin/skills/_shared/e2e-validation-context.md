# E2E Validation Context

The resolution-and-persistence contract for the facts a non-interactive cycle needs to run Stage 6 (E2E acceptance): validation strategy, local URL, backend status, Muggle Test project, test credentials, and auth. Two seeders write these into `state.md`; one consumer reads them.

- **Seeders:** [`../do/pre-flight.md`](../do/pre-flight.md) (forward pipeline, Stage 1) and [`../muggle-pr-followup/bootstrap.md`](../muggle-pr-followup/bootstrap.md) (watcher bootstrapped from a PR URL).
- **Consumer:** [`../do/e2e-acceptance.md`](../do/e2e-acceptance.md) Step 0.

A watcher spawned by a forward `/muggle-do` run inherits these from pre-flight through the shared session slot. A watcher bootstrapped directly from a PR URL never runs pre-flight, so bootstrap resolves them once at launch — when the user is present — and persists them for every later non-interactive tick.

## Silent detection

Resolve without prompting; use as questionnaire defaults:

1. Running dev server + backend health — per [`dev-server-readiness.md`](dev-server-readiness.md).
2. Muggle Test MCP auth — `muggle-remote-auth-status`.
3. Candidate projects — `muggle-remote-project-list`, ranked against the repo's dev URL and the PR title.
4. Existing test-user secrets — `muggle-remote-secret-list` per candidate project (`managed_profile_email` / `managed_profile_password`).
5. Auth0 tenant for local dev — grep the repo env file for `*AUTH0_DOMAIN*`.

## Questions

Present the E2E-validation subset of pre-flight's questionnaire in a single `AskUserQuestion`, using detected values as defaults. The canonical option wording lives in [`../do/pre-flight.md`](../do/pre-flight.md) — reference it, do not fork it:

- Validation strategy — pre-flight Q4
- Local URL — pre-flight Q5
- Backend reachable — pre-flight Q6
- Muggle Test project — pre-flight Q7
- Test-user credentials — pre-flight Q8
- Re-auth Muggle Test MCP — pre-flight Q10

The chosen **validation strategy is the standing decision for every cycle** of this session. It subsumes the [`autoE2ETest`](../muggle-preferences/preference-gates/autoE2ETest.md) gate's per-run prompting (pre-flight Q13), which has no meaning in a non-interactive loop: `local-e2e` runs Stage 6 each cycle; `unit-only` / `skip` stands down each cycle. The gate's `always` default makes `local-e2e` the strategy default when a dev server was detected.

Skip the forward-only questions (task scope, repo selection, branch name, PR target, worktree, rebase) — the PR's repo and head branch are already the checked-out working tree.

## Persisted fields

Write into `state.md` under a `## Pre-flight answers` block — the same shape pre-flight emits, so the consumer reads one format regardless of seeder:

- `Validation: <local-e2e | staging-replay | unit-only | skip>`
- `Local URL: <url | N/A>`
- `Backend status: <up | down | N/A>`
- `Muggle Test project: <name> (<uuid>)`
- `Test credentials: <existing | new | skip>`
- `Auth status: <ok | re-authed | N/A>`
- `Working tree: <path>` — the verified checkout the cycle runs against (the bootstrap analogue of pre-flight's worktree path)

A consumer that finds any required field missing treats it as a seeding bug: escalate with the session path and halt. Never silently skip E2E.
