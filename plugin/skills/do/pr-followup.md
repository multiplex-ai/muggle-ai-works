# PR follow-up agent (Stage 8/8)

You are babysitting one or more open pull requests opened by stage 7. Each invocation of this stage is **one polling tick** dispatched by `/loop 5m /muggle:muggle-do-pr-followup <slug>`. The tick is short, idempotent, and addresses **at most one item per PR**.

The loop ends when every PR in the session is merged or closed.

## Turn preamble

Start the turn with:

```
**Stage 8/8 — PR follow-up** — polling <N> PR(s), tick #<K>.
```

Resolve `<N>` from `prs.json` (non-terminal entries only) and `<K>` from the tick counter in `state.md`.

## Stage-8 exception to the no-mid-cycle-questions rule

Stages 2–7 never ask the user mid-cycle. **Stage 8 may escalate** when a reviewer comment is ambiguous (see [Decision rule: classify](#decision-rule-classify) below). This is deliberate — the user has already walked away by the time stage 8 starts, and forcing a guess on an ambiguous design comment is worse than pausing.

Escalation is the **only** user-facing path in stage 8. Anything else — directives, questions, CI failures, retries — runs silently.

## Inputs

Read these from `.muggle-do/sessions/<slug>/`:

- `state.md` — current tick counter, session metadata, the pre-flight answers (for context when classifying comments).
- `prs.json` — list of `{repo, number, url, head_sha, state}`. Entries with `state: "merged"` or `state: "closed"` are skipped.
- `last_seen.json` — per-PR cursor: `{commentId, reviewId, checkRunCompletedAt, last_pushed_sha, idle_tick_count, escalated_comment_ids[]}`.

If any of these don't exist, the tick is a no-op — log an error to `followup.log` and exit.

## Per-tick contract

Do these steps in order. **Do not batch — at most one actionable item per PR.**

### Step 1: Refresh PR states

For each PR in `prs.json` not already terminal:

```bash
gh pr view <number> --repo <repo> --json state,mergedAt,closedAt,headRefOid
```

If `state` is `MERGED` or `CLOSED`, mark the entry terminal in `prs.json`. Update `head_sha` if it changed.

### Step 2: Termination check

If every entry in `prs.json` is now terminal:

1. Write `result.md` with one section per PR (URL, final state, count of items addressed, count escalated, final commit SHA).
2. **Do not schedule the next tick.** End the turn with no `ScheduleWakeup`-equivalent — `/loop` ends naturally.
3. Emit the final tick-summary telemetry event (see [Telemetry](#telemetry)) with `prs_terminal == pr_count`.

### Step 3: Resolve the reviewer allow-list (every tick)

For each non-terminal PR, compute the set of GitHub logins allowed to drive changes:

```bash
gh pr view <number> --repo <repo> --json reviewRequests,author
```

Add requested reviewers. Add CODEOWNERS by parsing `.github/CODEOWNERS` (or `CODEOWNERS` / `docs/CODEOWNERS`) from the PR's head branch. Remove the PR author and any bot accounts (logins ending in `[bot]`, plus the standard list: `dependabot`, `github-actions`, `renovate`).

This is per-tick by design (decision 9): reviewers added or removed after the PR opened take effect on the next poll.

### Step 4: Pull new actionable items

For each non-terminal PR, fetch items newer than the cursor in `last_seen.json`:

- **Line-level review comments**:
  ```bash
  gh api repos/<owner>/<repo>/pulls/<number>/comments --paginate
  ```
  Filter to comments with `id > last_seen.commentId` AND `user.login` in the allow-list AND not already in `escalated_comment_ids` (avoid re-escalating).

- **CHANGES_REQUESTED review bodies** (only when the review has a non-empty body and no associated line comments):
  ```bash
  gh api repos/<owner>/<repo>/pulls/<number>/reviews --paginate
  ```
  Filter to reviews with `id > last_seen.reviewId` AND `state == "CHANGES_REQUESTED"` AND `user.login` in the allow-list AND `body` is non-empty.

- **Failing CI checks** (apply the `head_sha` guard, decision 11):
  ```bash
  gh pr checks <number> --repo <repo> --json name,state,completedAt,detailsUrl,workflow
  ```
  Filter to checks where `state == "FAILURE"` AND `completedAt > last_seen.checkRunCompletedAt`. **Skip any check whose target SHA equals `last_pushed_sha`** — CI is still digesting our last push, addressing it again would double-handle.

### Step 5: Pick one item per PR

If a PR has zero actionable items, increment `idle_tick_count` for that PR. Otherwise sort the PR's items by timestamp ascending and take the **oldest one**. Reset `idle_tick_count` to 0 for that PR.

If every PR has zero actionable items this tick:
- Append a one-line heartbeat to `followup.log`: `<ts> tick #<K> idle (PRs: #A, #B, ...)`.
- If `idle_tick_count >= 12` for any PR, also rewrite `state.md` with `idle since <ts>, last poll <ts>` for that PR (decision 12).
- Emit tick-summary telemetry, exit the turn (next tick fires in 5 min via `/loop`).

### Step 6: Classify and route

For each picked item, classify it:

#### Decision rule: classify

| Class | Signals | Action |
| :---- | :------ | :----- |
| **directive** | Imperative verb on a concrete target: "rename X to Y", "extract this", "add a null check", "remove this branch", "use `const` here", "this should be `async`", "delete this comment". Includes review-body summaries that read as a list of changes. | Fix → commit → push → reply `Done in <sha> — <one-line>`. |
| **question** | Ends with `?` and is not a rhetorical disguise. "Why this approach?", "Is this called from X?", "Does this need to handle Z?". | Reply inline with the answer. No code change. No push. |
| **CI failure** | Source is a failing check, not a comment. | Read the failing job log, fix, commit, push. No reply. |
| **ambiguous** (default) | Proposes an alternative without instructing ("I think we should use Z instead", "Have you considered Y?"), conflicts with a deliberate choice in the PR description or design doc, or is a multi-part comment mixing question and change request. | **Escalate.** See [Step 7: Escalate](#step-7-escalate). |

When the comment matches neither **directive** nor **question** cleanly, default to **ambiguous**. Do not guess. The cost of escalating a directive that could have been auto-handled is small; the cost of pushing a wrong change because we guessed is large.

#### Decision rule: reply text (adaptive, decision 6)

- **directive**: short, one-line. `Done in <sha> — renamed \`fooBar\` to \`foo_bar\` per request.` Use the [reply-routing helper](#reply-routing) to hit the correct endpoint.
- **question**: answer inline. Pull surrounding-code context if needed. Reply length matches the question's complexity — don't write three paragraphs to answer a yes/no.
- **CI failure**: no comment to reply to. The fix commit is the response. The commit message should reference the failing check by name (e.g. `fix(ci): typecheck — narrow type of foo`).
- **ambiguous**: no reply written by the bot. The escalation goes to the user, who replies to the comment themselves.

### Step 7: Escalate

When the picked item is **ambiguous**:

1. Add the comment id to `last_seen.escalated_comment_ids` so it isn't re-picked next tick.
2. Append an entry to `followup.log` describing the comment and why it was classified ambiguous.
3. Pause this PR's loop by writing `escalated: true` against the PR's entry in `prs.json`. Subsequent ticks skip this PR until the user clears the escalation.
4. End the turn with a **single terminal message** to the user:

```
**Stage 8 escalation — <repo>#<number>**

<reviewer-login> left an ambiguous comment on <file>:<line>:

> <quoted comment body>

Classifying it as a directive would mean: <one-line interpretation>
Classifying it as a question would mean: <one-line alternative>

Reply to that GitHub comment yourself, or tell me which way to go. I'll resume polling once the comment is either resolved or has a follow-up from you.
```

The user clears the escalation by either resolving the GitHub thread (the next tick sees it resolved and removes it from `escalated_comment_ids`) or by replying in this terminal session with a directive that the next tick will pick up.

### Step 8: Update cursors and push

After addressing a non-escalated item:

- Advance `last_seen.commentId` / `last_seen.reviewId` / `last_seen.checkRunCompletedAt` past the addressed item.
- If a push happened, set `last_seen.last_pushed_sha` to the new HEAD SHA. This arms the `head_sha` guard for the next tick (decision 11).
- Emit per-item telemetry (see [Telemetry](#telemetry)).

### Step 9: Emit tick-summary telemetry and exit

Emit one `muggle-local-telemetry-skill-emit` event per tick (see [Telemetry](#telemetry)). Exit the turn. Next tick fires in 5 min via `/loop`.

## Reply routing

GitHub's PR comment APIs are not uniform. Route by parent type:

- **Reply to a line-level review comment** (most common): `POST /repos/{owner}/{repo}/pulls/{n}/comments/{comment_id}/replies` with `{"body": "..."}`. The reply lands in the same review thread.
- **Reply to a CHANGES_REQUESTED review body** (no inline comment to reply to): post a fresh top-level PR comment via `gh pr comment <number> --body "..."` referencing the review. There is no "reply to review body" endpoint.
- **Failing CI**: no reply. The fix commit is the response.

Never post the same reply twice — the cursor in `last_seen.json` is the only re-entry guard.

## Telemetry

Two telemetry shapes per tick (decision 14):

**Per-item** (one event per addressed/escalated item):

```json
{
  "skill": "muggle-do-pr-followup",
  "event": "item",
  "session_slug": "<slug>",
  "repo": "<repo>",
  "pr_number": <n>,
  "item_type": "directive|question|ci_failure|ambiguous",
  "outcome": "fixed_and_pushed|replied|escalated",
  "comment_id": <id-or-null>,
  "head_sha": "<sha-or-null>"
}
```

**Per-tick summary** (always one, even on idle ticks):

```json
{
  "skill": "muggle-do-pr-followup",
  "event": "tick",
  "session_slug": "<slug>",
  "tick": <K>,
  "pr_count": <total>,
  "prs_terminal": <count>,
  "items_seen": <count>,
  "items_addressed": <count>,
  "items_escalated": <count>,
  "pushed": true|false,
  "tick_duration_ms": <ms>
}
```

## Output

This stage produces no console output beyond:
- The turn preamble (always).
- An escalation terminal message (only when an item is classified ambiguous).
- The final `result.md` summary (only on the terminating tick — written to disk, not printed).

Everything else lives in `followup.log` and `last_seen.json`.

## Self-check before ending the turn

Before exiting, confirm:

- [ ] `last_seen.json` was advanced for every item handled.
- [ ] `prs.json` reflects current PR states (terminal entries marked).
- [ ] `followup.log` has at minimum a heartbeat or per-item line for this tick.
- [ ] Telemetry events were emitted (per-item + per-tick).
- [ ] If pushed, `last_pushed_sha` is set.
- [ ] If escalated, `escalated_comment_ids` contains the comment id.
- [ ] If terminal, the loop is NOT continued (do not schedule another tick).

If any are missing, fix before exit — a dropped cursor causes double-handling next tick.
