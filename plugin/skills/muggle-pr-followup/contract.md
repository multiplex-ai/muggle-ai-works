# PR follow-up per-tick contract

Caller-agnostic per-tick contract for the [muggle-pr-followup](SKILL.md) skill. One tick = one polling iteration scoped to one PR.

## Turn preamble

```
**PR follow-up** — polling <repo>#<pr-number>, tick #<K>.
```

Resolve `<K>` from `idle_tick_count + cycles_completed` in this PR's state slot.

## When this contract may break the caller's "no questions" rule

Most callers' forward pipelines never ask the user mid-cycle. This loop, however, may emit a single escalation message when a submitted review is ambiguous (see [classify](#step-6-classify-the-review) below). By the time the loop is polling, the user has walked away from the forward pipeline; forcing a guess on an ambiguous review is worse than pausing.

Escalation is the **only** user-facing path. Otherwise the cycle runs silently end to end.

## Inputs

Read these from `.muggle-<caller>/sessions/<slug>/` (the caller's session dir):

- `state.md` — session metadata (for context when classifying reviews).
- `prs.json` — list of `{repo, number, url, head_sha, state, escalated?, cycling?}`. This loop touches only the entry whose `number` matches the dispatched PR number.
- `last_seen.json` — keyed by `"<owner>/<repo>#<n>"`. For this PR: `{reviewId, last_pushed_sha, idle_tick_count, cycles_completed, escalated_review_ids[]}`.
- `cycle.json` — caller's declared implementation cycle (see [SKILL.md](SKILL.md#caller-supplied-implementation-cycle)).

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
- `id` is not in `escalated_review_ids`.
- `state` is `CHANGES_REQUESTED` or `COMMENTED`, OR `APPROVED` with at least one line comment or a non-empty body.

### Step 5: Pick the oldest new review

If no new review past the cursor: increment `idle_tick_count`, append a heartbeat line to `followup.log`, exit. Next tick fires in 1 min via `/loop`.

If one or more: take the oldest by `submitted_at`. Fetch its associated line comments (`gh api repos/<owner>/<repo>/pulls/<n>/comments` filtered by `pull_request_review_id`). Reset `idle_tick_count` to 0.

**At most one review per tick.** If two reviews land between ticks, the second waits.

### Step 6: Classify the review

Apply the classify rule in [`../_shared/pr-followup-helpers.md`](../_shared/pr-followup-helpers.md). The rule applies to the **review as a unit**. Two outcomes:

- **Actionable** → continue to Step 7.
- **Ambiguous** → continue to Step 8.

### Step 7: Dispatch the implementation cycle

When the review is actionable:

1. **Pause polling** for this PR (set `cycling: true` on this PR's entry in `prs.json`).
2. **Amend `requirements.md`** in the session dir with a new `## Amendment — review <review_id> by <login> (<timestamp>)` section pasting the review body and each comment (with `<file>:<line>` context).
3. **Invoke the implementation cycle** declared in the caller's `cycle.json`. Iterate the `steps[]` in order. Each step is either a markdown file to follow, a skill to invoke, or a shell command (per the `cycle.json` schema in SKILL.md). When a step fails, the cycle returns `failed: <step-name>`; the loop escalates per Step 8 with the failure as the reason.
4. **Push** via `cycle.json`'s `pushHandler`. Set `last_seen.last_pushed_sha` to the new HEAD.
5. **Reply** with one summary via `gh pr comment <n>`:
   ```
   Addressed review <review_id> in <sha> — cycle ran clean (or: with <N> failures, see walkthrough).
   ```
6. **Resume polling**: clear `cycling: true`, increment `cycles_completed`, advance `last_seen.reviewId` past this review.
7. Emit per-cycle telemetry.

If the cycle returns `failed: design-adjustment` (the cycle discovered the review can't be implemented without rethinking the design itself, not just the code), escalate per Step 8 with a `design-adjustment` reason — the terminal message asks the user to confirm the design intent before retrying.

### Step 8: Escalate

When the review is ambiguous, or the cycle failed:

1. Add the review id to `last_seen.escalated_review_ids`.
2. Append a `followup.log` entry describing the review and the reason.
3. Pause this PR's loop by writing `escalated: true` against this PR's entry in `prs.json`.
4. End the turn with a **single terminal message** to the user:

```
**PR follow-up escalation — <repo>#<number> — review <review_id>**

<reviewer-login> submitted a review I can't act on coherently:

> <quoted review body, or "(no body)" if empty>

Comments:
- <file>:<line> — <quoted comment body>

[For ambiguous]
Best two interpretations:
1. <one-line interpretation A>
2. <one-line interpretation B>

[For cycle failure]
The implementation cycle failed at <step-name>: <reason>.

Reply on the review yourself, leave a follow-up comment, or tell me which way to go.
```

The user clears the escalation by replying on GitHub (next tick sees a new submitted review past the cursor) or by giving a directive in this terminal session.

### Step 9: Emit tick-summary telemetry and exit

Emit one tick event per `muggle-local-telemetry-skill-emit`. Exit the turn.

## Reply routing

- **Summary reply on a review**: `gh pr comment <number> --body "..."` referencing the review id and the new SHA. There's no "reply to a review" endpoint.
- **Reply to a specific line comment** (optional): `POST /repos/{owner}/{repo}/pulls/{n}/comments/{comment_id}/replies`.
- **Never post the same summary twice** — `last_seen.reviewId` is the only re-entry guard.

## Telemetry

**Per-cycle** (one event per actionable review handled):

```json
{
  "skill": "muggle-pr-followup",
  "event": "cycle",
  "caller": "<caller>",
  "session_slug": "<slug>",
  "repo": "<repo>",
  "pr_number": <n>,
  "review_id": <id>,
  "outcome": "pushed|escalated|failed:<step>",
  "comment_count": <count>,
  "head_sha_before": "<sha>",
  "head_sha_after": "<sha-or-null>"
}
```

**Per-tick summary** (always one, even idle):

```json
{
  "skill": "muggle-pr-followup",
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
- An escalation terminal message (only when escalating).
- The final `result.md` summary section for this PR (only on the terminating tick — written to disk, not printed).

## Self-check before ending the turn

- [ ] `last_seen.json` advanced for any review handled.
- [ ] `prs.json` reflects current state (terminal marked; `escalated`/`cycling` flags consistent).
- [ ] `followup.log` has at minimum a heartbeat or per-review line for this tick.
- [ ] Telemetry events emitted (per-cycle when applicable + per-tick).
- [ ] If pushed, `last_pushed_sha` is set and `cycles_completed` incremented.
- [ ] If escalated, `escalated_review_ids` contains the review id.
- [ ] If terminal, the loop is NOT continued.
