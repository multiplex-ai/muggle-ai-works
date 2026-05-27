# Auto-Track Procedure

The procedure for the **auto-track mode** of `muggle-pr-followup` — invoked when the skill is dispatched with **no arguments**. Routing is in [`SKILL.md`](SKILL.md#routing).

Auto-track discovers the PRs you pushed or opened during this Claude Code session — across **any repo** — and starts one **poll-only watcher** per PR. The watcher only watches: it seeds nothing about E2E. Running and posting E2E is `/muggle-do`'s job; a watcher with no validation context yields a `SKIPPED` E2E verdict when `/muggle-do` runs — see [`../do/e2e-acceptance.md`](../do/e2e-acceptance.md) Step 0.

## Turn preamble

```
**muggle-pr-followup auto-track** — tracking PRs from this session.
```

## Input

`$ARGUMENTS` is empty.

## Procedure

### Step 1 — Discover candidate PRs from session context

Review this conversation. A PR counts as **pushed this session** if, earlier in this session, any of the following happened:

- you opened it (`gh pr create`), or
- you pushed commits to a branch that has an open PR, or
- it was established as the active PR you were working on (its URL appeared and you acted on it).

Collect each candidate's canonical URL (`https://github.com/<owner>/<repo>/pull/<n>`). Candidates may span multiple repos.

### Step 2 — Decide confident vs. uncertain

- **Confident** — context clearly identifies one or more PRs pushed this session. Use that set as the track list and go to Step 4. **Do not prompt.**
- **Uncertain** — no PR is clearly attributable to this session, or you cannot tell which of several candidates the user means. Go to Step 3.

### Step 3 — Picker (uncertain only)

Build a candidate list from the Step 1 URLs, plus — if the current working directory is a git repo — `gh pr list --author @me --state open --json number,title,url,headRefName` for that repo. Present an `AskUserQuestion` **multi-select** picker of the candidates (PR number + title + repo).

- Empty selection → exit with a one-line note (`No PRs selected; nothing to track.`). Write nothing.
- One or more selected → use them as the track list and go to Step 4.

### Step 4 — Seed one poll-only watcher per PR

For each PR URL in the track list, run the [`bootstrap.md`](bootstrap.md) procedure with these auto-track overrides:

- **Skip Step 3 (verify working tree).** PRs may live in any repo, so the matching checkout need not be the current working tree. If you know which directory the PR was pushed from this session, record it as `Working tree: <path>` in `state.md`; otherwise omit it. `/muggle-do` resolves the working tree when it runs.
- **Skip Step 6.5 (E2E validation context).** The watcher owns no E2E concern. Do **not** write a `## Pre-flight answers` block.
- **Existing slot → skip silently** (never the slot-conflict abort). Add it to the *skipped* list.
- **`caller = "auto-track"`** in the bootstrap telemetry event.

Everything else from bootstrap is unchanged: URL parse, metadata fetch + terminal-PR abort, slug + slot path, cursor 0 default (process prior reviews on the first tick), and the `prs.json` / `last_seen.json` / `state.md` writes — minus the pre-flight block.

### Step 5 — Print the summary

```
muggle-pr-followup auto-track

Tracked (new):
  <slug> → <owner>/<repo>#<n>
  ...
  (or "none")
Already tracking (skipped):
  <slug> → <owner>/<repo>#<n>
  ...
  (or "none")

Dispatching:
  /loop 1m /muggle:muggle-pr-followup <slug> <n>
  ...
```

Print the summary **before** the `/loop` dispatches so it stays visible.

### Step 6 — Dispatch the watchers

As the last action of the turn, emit one `/loop` line per **newly tracked** PR (not the skipped ones):

```
/loop 1m /muggle:muggle-pr-followup <slug> <n>
```

Each registers an independent cron — the N-independent-watchers model from [`SKILL.md`](SKILL.md).

### Step 7 — Emit telemetry

One bootstrap event per **newly tracked** PR per [`../_shared/telemetry-events/pr-followup-bootstrap.md`](../_shared/telemetry-events/pr-followup-bootstrap.md), with `caller = "auto-track"`. Fire-and-forget per [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Skipped PRs emit nothing.

## Invariants

- **Tracking depends only on the PR.** No E2E context is gathered, prompted for, or required.
- **Idempotent.** Existing slots are skipped; re-running never double-tracks.
- **No-op is silent.** Empty discovery followed by an empty picker writes nothing and dispatches nothing.
