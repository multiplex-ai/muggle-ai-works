# Resolving the E2E Validation Context

**How-to procedure.** Followed by any seeder that prepares a session for unattended Stage 6 (E2E acceptance) runs.

**Goal:** resolve — once, while the user is present — everything Stage 6 needs to run without further prompts (validation strategy, local URL, backend status, Muggle Test project, test credentials, auth), and persist it to `state.md` so every later non-interactive run reads it instead of asking.

The sections below are the steps in order: reuse an existing context if one is on disk, else detect what's resolvable silently, ask the rest in one question, and write the result. The final [`## Persisted fields`](#persisted-fields) section doubles as the schema the cycle reads back.

## Reuse an existing context

If a `## Pre-flight answers` block already exists for this working tree — the current session slot, or the most recent sibling session under `~/.muggle-ai/muggle-do/sessions/*` — fire the [`autoReuseValidationContext`](../muggle-preferences/preference-gates/autoReuseValidationContext.md) gate before gathering anything:

- `always` → copy the existing block into this session; skip the questionnaire.
- `never` → ignore it; run the full gather below.
- `ask` → prompt reuse-vs-re-gather.

Run the gather only when no block exists or the user chose to re-gather.

## Silent detection

Resolve without prompting; use as questionnaire defaults:

1. Dev server + backend health — per [`dev-server-readiness.md`](dev-server-readiness.md).
2. Muggle Test MCP auth — `muggle-remote-auth-status`.
3. Candidate projects — `muggle-remote-project-list`, ranked against the repo's dev URL and the PR title.
4. Existing test-user secrets — `muggle-remote-secret-list` per candidate project (`managed_profile_email` / `managed_profile_password`).
5. Auth0 tenant for local dev — grep the repo env file for `*AUTH0_DOMAIN*`.

## Questions

One `AskUserQuestion` for the validation subset, detected values as defaults. Ask each with the same intent the interactive pre-flight uses; the caller supplies the exact option wording:

- Validation strategy — pre-flight Q4
- Local URL — pre-flight Q5 (defers to [`autoSelectLocalHost`](../muggle-preferences/preference-gates/autoSelectLocalHost.md))
- Backend reachable — pre-flight Q6
- Muggle Test project — pre-flight Q7 (defers to [`autoSelectProject`](../muggle-preferences/preference-gates/autoSelectProject.md))
- Test-user credentials — pre-flight Q8
- Re-auth Muggle Test MCP — pre-flight Q10

The chosen **validation strategy is the standing decision for every cycle** — no per-tick re-prompt. It subsumes the [`autoE2ETest`](../muggle-preferences/preference-gates/autoE2ETest.md) gate (pre-flight Q13), meaningless in a loop: `local-e2e` runs Stage 6 each cycle; `unit-only` / `skip` stands down. The gate's `always` default makes `local-e2e` the default when a dev server is detected.

Skip the forward-only questions (task scope, repo, branch, PR target, worktree, rebase) — the targeted repo and head branch are already checked out.

## Persisted fields

Write to `state.md` under a `## Pre-flight answers` block:

- `Validation: <local-e2e | staging-replay | unit-only | skip>`
- `Local URL: <url | N/A>`
- `Backend status: <up | down | N/A>`
- `Muggle Test project: <name> (<uuid>)`
- `Test credentials: <existing | new | skip>`
- `Auth status: <ok | re-authed | N/A>`
- `Working tree: <path>` — the verified checkout the cycle runs against

Once the strategy is `local-e2e`, missing any of its required fields (`Local URL`, `Muggle Test project`) is a seeding bug — escalate with the session path and halt; don't silently downgrade a chosen `local-e2e` to a skip. But `unit-only` and `skip` are valid first-class strategies for a PR with no testable surface — they need none of those fields, and a session seeded with no block at all is itself a clean skip.
