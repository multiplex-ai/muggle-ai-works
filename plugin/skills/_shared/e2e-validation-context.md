# E2E Validation Context

The context Stage 6 (E2E acceptance) needs to run unattended: validation strategy, local URL, backend status, Muggle Test project, test credentials, auth. Two seeders write it to `state.md`; one consumer reads it.

- **Seeders:** [`../do/pre-flight.md`](../do/pre-flight.md) (forward pipeline, Stage 1) and [`../muggle-pr-followup/bootstrap.md`](../muggle-pr-followup/bootstrap.md) (URL-bootstrapped watcher).
- **Consumer:** [`../do/e2e-acceptance.md`](../do/e2e-acceptance.md) Step 0.

A forward-spawned watcher inherits this from pre-flight via the shared session slot. A URL-bootstrapped watcher never runs pre-flight, so bootstrap resolves it once at launch (user present) and persists it for every later tick.

## Silent detection

Resolve without prompting; use as questionnaire defaults:

1. Dev server + backend health — per [`dev-server-readiness.md`](dev-server-readiness.md).
2. Muggle Test MCP auth — `muggle-remote-auth-status`.
3. Candidate projects — `muggle-remote-project-list`, ranked against the repo's dev URL and the PR title.
4. Existing test-user secrets — `muggle-remote-secret-list` per candidate project (`managed_profile_email` / `managed_profile_password`).
5. Auth0 tenant for local dev — grep the repo env file for `*AUTH0_DOMAIN*`.

## Questions

One `AskUserQuestion` for the validation subset, detected values as defaults. Canonical wording in [`../do/pre-flight.md`](../do/pre-flight.md) — reference, don't fork:

- Validation strategy — pre-flight Q4
- Local URL — pre-flight Q5
- Backend reachable — pre-flight Q6
- Muggle Test project — pre-flight Q7
- Test-user credentials — pre-flight Q8
- Re-auth Muggle Test MCP — pre-flight Q10

The chosen **validation strategy is the standing decision for every cycle** — no per-tick re-prompt. It subsumes the [`autoE2ETest`](../muggle-preferences/preference-gates/autoE2ETest.md) gate (pre-flight Q13), meaningless in a loop: `local-e2e` runs Stage 6 each cycle; `unit-only` / `skip` stands down. The gate's `always` default makes `local-e2e` the default when a dev server is detected.

Skip the forward-only questions (task scope, repo, branch, PR target, worktree, rebase) — the PR's repo and head branch are already checked out.

## Persisted fields

Write to `state.md` under a `## Pre-flight answers` block — pre-flight's shape, so the consumer reads one format:

- `Validation: <local-e2e | staging-replay | unit-only | skip>`
- `Local URL: <url | N/A>`
- `Backend status: <up | down | N/A>`
- `Muggle Test project: <name> (<uuid>)`
- `Test credentials: <existing | new | skip>`
- `Auth status: <ok | re-authed | N/A>`
- `Working tree: <path>` — the verified checkout the cycle runs against (bootstrap's analogue of pre-flight's worktree path)

Missing any required field is a seeding bug: escalate with the session path and halt. Never silently skip E2E.
