# PR follow-up agent (Stage 8)

You are babysitting **one** open pull request opened by stage 7. Each invocation of this stage is **one polling tick** dispatched by `/loop 1m /muggle:muggle-do-pr-followup <slug> <pr-number>`. The tick is short and idempotent.

The loop ends when this PR is merged or closed.

## Turn preamble

```
**Stage 8 — PR follow-up** — polling <repo>#<pr-number>, tick #<K>.
```

Resolve `<K>` from `idle_tick_count + cycles_completed` in this PR's state slot.

## Stage-8 exception to the no-mid-cycle-questions rule

Stages 2–7 never ask the user mid-cycle. **Stage 8 may escalate** when a submitted review is ambiguous (see [Classify](#step-6-classify-the-review) below). The user has already walked away by the time stage 8 starts, and forcing a guess on an ambiguous review risks pushing wrong work.

Escalation is the **only** user-facing path in stage 8. Otherwise the cycle runs silently end to end.

## Inputs

Read these from `.muggle-do/sessions/<slug>/`:

- `state.md` — session metadata + pre-flight answers (for context when classifying reviews).
- `prs.json` — list of `{repo, number, url, head_sha, state, escalated?, cycling?}`. This loop touches only the entry whose `number` matches the dispatched PR number.
- `last_seen.json` — keyed by `"<owner>/<repo>#<n>"`. For this PR: `{reviewId, last_pushed_sha, idle_tick_count, cycles_completed, escalated_review_ids[]}`.

If any of these don't exist or the PR isn't in `prs.json`, the tick is a no-op — log an error to `followup.log` and exit.

## Per-tick contract

### Step 1: Refresh this PR's state

```bash
gh pr view <number> --repo <repo> --json state,mergedAt,closedAt,headRefOid
```

If `state` is `MERGED` or `CLOSED`, mark this entry terminal in `prs.json`. Update `head_sha` if it changed.

### Step 2: Termination check

If this PR is terminal: write a per-PR section into `result.md` (URL, final state, `cycles_completed`, count escalated, final SHA), emit final telemetry, **do not schedule another tick**. Other PRs in the session have their own loops; they terminate independently.

### Step 3: Resolve the reviewer allow-list (every tick)

```bash
gh pr view <number> --repo <repo> --json reviewRequests,author
```

Add requested reviewers. Add CODEOWNERS by parsing `.github/CODEOWNERS` (or `CODEOWNERS` / `docs/CODEOWNERS`) from the PR's head branch. Remove the PR author and any bot accounts (logins ending in `[bot]`, plus the standard list: `dependabot`, `github-actions`, `renovate`, `mergify`).

### Step 4: Pull new submitted reviews

```bash
gh api repos/<owner>/<repo>/pulls/<number>/reviews --paginate
```

Filter to reviews where:

- `submitted_at` is non-null (skip drafts — `PENDING` reviews are still being composed).
- `id > last_seen.reviewId`.
- `user.login` is in the allow-list.
- `id` is not in `escalated_review_ids` (avoid re-escalating).
- `state` is `CHANGES_REQUESTED` or `COMMENTED`, OR `APPROVED` with at least one line comment or a non-empty body. A pure-approval with no notes is not a follow-up trigger.

The unit of work is the **submitted review**. Individual line comments belonging to a review are fetched alongside via `gh api repos/<owner>/<repo>/pulls/<n>/comments` filtered by `pull_request_review_id` matching the picked review.

### Step 5: Pick the oldest new review

If no new review past the cursor: increment `idle_tick_count`, append a heartbeat line to `followup.log`, exit. Next tick fires in 1 min via `/loop`.

If one or more: take the oldest by `submitted_at`. Fetch its associated line comments. Reset `idle_tick_count` to 0.

**At most one review per tick.** If two reviews land between ticks, the second waits for the next tick — a second cycle isn't dispatched until the first finishes.

### Step 6: Classify the review

Apply the classify rule in [`../_shared/pr-followup-helpers.md`](../_shared/pr-followup-helpers.md). The rule applies to the **review as a unit** — the review body plus all its comments collectively. Two outcomes:

- **Actionable** — the review's content gives enough direction to amend the requirements. Default for any review where at least one comment names a concrete change or asks an answerable question. Continue to Step 7.
- **Ambiguous** — the review gives no actionable direction (vibes-only, contradictory, references context the loop doesn't have). Continue to Step 8.

### Step 7: Dispatch the full dev cycle

When the review is actionable:

1. **Pause polling** for this PR (set `cycling: true` on this PR's entry in `prs.json`).
2. **Amend `requirements.md`** in the session dir with a new `## Amendment — review <review_id> by <login> (<timestamp>)` section that pastes the review body and each comment (with `<file>:<line>` context). The amendment is appended; the original goal/AC stay above for reference.
3. **Dispatch the dev cycle** starting at Stage 3 (Build) with the amended `requirements.md`. Build operates on the existing branch (no fresh worktree). Run forward through Stage 4 (Impact analysis), Stage 5 (Unit tests), Stage 6 (E2E acceptance). Re-post the visual walkthrough via `muggle-pr-visual-walkthrough` Mode A to this PR (replaces the previous walkthrough comment or appends fresh — the skill decides).
4. **Push** the new commit(s) to the existing branch. Set `last_seen.last_pushed_sha` to the new HEAD.
5. **Reply** with one summary comment via `gh pr comment <n>`:
   ```
   Addressed review <review_id> in <sha> — Stage 3 → 6 ran clean (or: with <N> failures, see walkthrough). Fresh walkthrough above.
   ```
   Per-comment line replies are optional; the single summary keeps noise low.
6. **Resume polling**: clear `cycling: true`, increment `cycles_completed`, advance `last_seen.reviewId` past this review.
7. Emit per-cycle telemetry.

If any dev-cycle stage fails (build can't implement; tests fail after 3 retries; E2E fails after 3 retries), escalate via the same path as Step 8 with the specific blocker — do not push a half-finished cycle.

### Step 8: Escalate

When the review is ambiguous:

1. Add the review id to `last_seen.escalated_review_ids` so it isn't re-picked next tick.
2. Append a `followup.log` entry describing the review and the reason it was classified ambiguous.
3. Pause this PR's loop by writing `escalated: true` against this PR's entry in `prs.json`.
4. End the turn with a **single terminal message**:

```
**Stage 8 escalation — <repo>#<number> — review <review_id>**

<reviewer-login> submitted a review I can't act on coherently:

> <quoted review body, or "(no body)" if empty>

Comments:
- <file>:<line> — <quoted comment body>
- <file>:<line> — <quoted comment body>

Best two interpretations:
1. <one-line interpretation A>
2. <one-line interpretation B>

Reply on the review yourself, leave a follow-up comment, or tell me which way to go. I'll resume polling once you respond.
```

The user clears the escalation by replying on GitHub (next tick sees a new submitted review past the cursor) or by giving a directive in this terminal session.

### Step 9: Emit tick-summary telemetry and exit

Emit one tick event per `muggle-local-telemetry-skill-emit`. Exit the turn. Next tick fires in 1 min.

## Reply routing

Replies addressed to a whole review:

- **Summary reply** (default for an addressed review): `gh pr comment <number> --body "..."`. Reference the review id and the new SHA. There is no "reply to a review as a whole" endpoint; a top-level PR comment is the convention.
- **Reply to a specific line comment within a review** (optional): `POST /repos/{owner}/{repo}/pulls/{n}/comments/{comment_id}/replies`. Use when one comment in the review specifically asked a question that benefits from inline context.

Never post the same summary twice — the `last_seen.reviewId` cursor is the only re-entry guard.

## Telemetry

Two telemetry shapes per tick:

**Per-cycle** (one event per actionable review handled):

```json
{
  "skill": "muggle-do-pr-followup",
  "event": "cycle",
  "session_slug": "<slug>",
  "repo": "<repo>",
  "pr_number": <n>,
  "review_id": <id>,
  "outcome": "pushed|escalated|build_failed|tests_failed|e2e_failed",
  "comment_count": <count>,
  "head_sha_before": "<sha>",
  "head_sha_after": "<sha-or-null>"
}
```

**Per-tick summary** (always one, even idle):

```json
{
  "skill": "muggle-do-pr-followup",
  "event": "tick",
  "session_slug": "<slug>",
  "repo": "<repo>",
  "pr_number": <n>,
  "reviews_seen": <count>,
  "review_picked": true|false,
  "cycle_dispatched": true|false,
  "tick_duration_ms": <ms>
}
```

## Output

This stage produces no console output beyond:
- The turn preamble (always).
- An escalation terminal message (only when a review is classified ambiguous).
- The final `result.md` summary section for this PR (only on the terminating tick — written to disk, not printed).

Everything else lives in `followup.log` and `last_seen.json`.

## Self-check before ending the turn

- [ ] `last_seen.json` was advanced for any review handled.
- [ ] `prs.json` reflects current PR state (terminal marked; `escalated`/`cycling` flags consistent).
- [ ] `followup.log` has at minimum a heartbeat or per-review line for this tick.
- [ ] Telemetry events were emitted (per-cycle when applicable + per-tick).
- [ ] If pushed, `last_pushed_sha` is set and `cycles_completed` is incremented.
- [ ] If escalated, `escalated_review_ids` contains the review id.
- [ ] If terminal, the loop is NOT continued.
