# Auto-Track Procedure

The procedure for the **auto-track mode** of `muggle-pr-followup` — invoked when the skill is dispatched with **no arguments**. Routing is in [`SKILL.md`](SKILL.md#routing).

Auto-track discovers the PRs you pushed or opened during this Claude Code session — across **any repo** — and starts one **poll-only watcher** per PR. The watcher only watches: it seeds nothing about E2E. Running and posting E2E is `/muggle-do`'s job; a watcher with no validation context yields a `SKIPPED` E2E verdict when `/muggle-do` runs.

## Turn preamble

```
**muggle-pr-followup auto-track** — tracking PRs from this session.
```

## Input

`$ARGUMENTS` is empty.

## Procedure

### Step 0 — Reconcile existing slots

Run [`reconcile.md`](reconcile.md) first. A no-arg invocation is the natural moment to finalize any slot whose PR merged or closed while its watcher was down — an expired `/loop` cron or an ended session leaves termination un-run (see reconcile's rationale). Then continue discovering new PRs below.

### Step 1 — Discover candidate PRs from session context

A PR counts as **pushed this session** if, earlier in this conversation, you:

- opened it (`gh pr create`), or
- pushed commits to a branch that has an open PR, or
- acted on it as the active PR (its URL appeared and you worked it).

Collect each candidate's canonical URL (`https://github.com/<owner>/<repo>/pull/<n>`); candidates may span repos.

### Step 2 — Decide confident vs. uncertain

- **Confident** — context clearly identifies one or more PRs pushed this session. Use that set; go to Step 4. **Do not prompt.**
- **Uncertain** — nothing clearly attributable, or several candidates are plausible. Go to Step 3.

### Step 3 — Picker (uncertain only)

Build a candidate list from the Step 1 URLs, plus — if the current working directory is a git repo — `gh pr list --author @me --state open --json number,title,url,headRefName` for that repo. Present an `AskUserQuestion` **multi-select** picker of the candidates (PR number + title + repo).

- Empty selection → exit with a one-line note (`No PRs selected; nothing to track.`). Write nothing.
- One or more selected → use them as the track list and go to Step 4.

### Step 4 — Seed one poll-only watcher per PR

For each PR URL in the track list, run the [`bootstrap.md`](bootstrap.md) procedure with these auto-track overrides:

- **Skip Step 3 (verify working tree).** The PR's checkout need not be the current tree. If you know which directory it was pushed from, record `Working tree: <path>` in `state.md`; else omit it — `/muggle-do` resolves the tree when it runs.
- **Skip Step 6.5 (E2E validation context).** The watcher owns no E2E concern; do **not** write a `## Pre-flight answers` block.
- **Existing slot → skip silently** (never the slot-conflict abort); add it to the *skipped* list.
- **`caller = "auto-track"`** in the bootstrap telemetry event.

Everything else is unchanged: URL parse, metadata + terminal-PR abort, slug, `lastBodyReviewId` 0 (line-comment threads are picked up live from thread state; body-only reviews from id 0), and the `prs.json`/`last_seen.json`/`cron.json`/`state.md` writes minus the pre-flight block.

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

Arming:
  <owner>/<repo>#<n>
  ...
```

Print the summary **before** arming the watchers so it stays visible.

### Step 6 — Arm the watchers

Arm one watch per **newly tracked** PR (not the skipped ones), per [`arm-watcher.md`](arm-watcher.md). Each watch is independent — one drain tick and one labeled monitor per PR.

### Step 7 — Emit telemetry

One bootstrap event per **newly tracked** PR per [`../_shared/telemetry-events/pr-followup-bootstrap.md`](../_shared/telemetry-events/pr-followup-bootstrap.md), with `caller = "auto-track"`. Fire-and-forget per [`../_shared/telemetry-emit.md`](../_shared/telemetry-emit.md). Skipped PRs emit nothing.

## Invariants

- **Tracking depends only on the PR.** No E2E context is gathered, prompted for, or required.
- **Idempotent.** Existing slots are skipped; re-running never double-tracks.
- **No-op is silent.** Empty discovery followed by an empty picker writes nothing and dispatches nothing.
