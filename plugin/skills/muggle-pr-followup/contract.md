# Watcher Per-Tick Contract

The procedure for the **tick mode** of `muggle-pr-followup` — one polling iteration scoped to one PR. The watcher is a dumb pipe: it polls for actionable review threads, CI checks, and the branch's standing against its base, dispatches `/muggle-do` if there's unaddressed review feedback, fixable red CI, or a branch that's behind or conflicting with its base, and exits. It does not classify, fix, resolve, rebase, amend requirements, post replies, run cycles, or escalate.

Routing into this mode is documented in [`SKILL.md`](SKILL.md#routing). The architectural rationale lives in the brain docs `architecture/2026-05-08-muggle-do-pr-comment-loop-design.md` (the overall loop) and `architecture/2026-06-06-pr-followup-thread-state-baseline-design.md` (the thread-state dispatch trigger).

## Turn preamble

```
**muggle-pr-followup tick** — polling <repo>#<pr-number>.
```

## Input

`$ARGUMENTS = <slug> <pr-number> [--wake=<event>]` (or `<pr-number>` alone — slug inferred from on-disk state per [`SKILL.md`](SKILL.md#routing)). `--wake` is consumed by routing's live-watcher gate; the tick itself ignores it. An invocation that reaches this file has already passed that gate — a live watcher plus no `--wake` never gets here.

## Inputs from disk

Read these from `~/.muggle-ai/muggle-do/sessions/<slug>/`:

- `prs.json` — see [`state-schemas.md`](state-schemas.md#prsjson). The watcher touches the single entry whose `number` matches the dispatched PR number.
- `last_seen.json` — see [`state-schemas.md`](state-schemas.md#last_seenjson). Keyed by `"<owner>/<repo>#<n>"`.

If either file is missing or the PR is not in `prs.json`, the tick is a no-op. Log an error line in `followup.log` and exit. The watcher must not be invoked in this state — if it happens, the slot is corrupt.

## Writing state

Every `increment`/`reset` this procedure applies to `last_seen.json`, and the `prs.json` refresh in Step 1, is a **whole-file rewrite** (Read → change field → Write) per [`../_shared/session-state-writes.md`](../_shared/session-state-writes.md). **Never** patch session JSON with the Edit tool — an exact-string match against these files silently fails ("malformed edit") and drops the update, so the counter never advances.

## Dispatching

Every hand-off below — address-reviews, rebase, fix-ci, post-merge cleanup — fires `/muggle-do` through the Skill tool: skill `muggle-do`, with the directive after the command as its arguments (e.g. `address reviews <ids> on <pr-url> slug=<slug>`). A directive printed in the reply dispatches nothing: no cycle runs, and the PR sits with its work due.

## Procedure

Every tick event this procedure emits is one call to `muggle-local-telemetry-event-emit` with `eventType: "muggle-pr-followup:tick"` and `skillName: "muggle-pr-followup"`, its fields as metadata ([`../_shared/telemetry-events/pr-followup-tick.md`](../_shared/telemetry-events/pr-followup-tick.md)). The bare word `tick` in a step below names that event, never the `eventType` value.

### Step 0 — Stopped-slot absorb, stale-fire guard, then record this cron's id

**Stopped-slot absorb — before anything else, including the disk reads above.** If the kill file `~/.muggle-ai/muggle-do/polling.disabled` exists, or the slot dir is absent but `~/.muggle-ai/muggle-do/sessions/<slug>.stopped/` exists (the owner ran [`stop.md`](stop.md)), absorb: no fetch, no state write, no log line — output one line (`stopped: <slug> — absorbed`) and exit. This gate is what makes an **unreachable orphaned cron** harmless: a cron whose handle a compaction severed can neither be enumerated by `CronList` nor deleted by its recorded id, so it fires until its session dies — the absorb caps each fire at one line of output and nothing else. Never "fix" an orphan by deleting ids `CronList` does surface; those belong to other live watchers.

If `prs.json[0].state` on disk is already `merged` or `closed`, this slot was finalized by a prior tick and this is a stale (queued) fire — per-minute cron fires enqueued while the session was busy still drain after the cron is cancelled. Defensively cancel any lingering cron for this slug per [`cancel-cron.md`](cancel-cron.md), which reports **found** (a reachable cron was cancelled) or **not-found** (neither lookup matched a live cron). Append a `stale-tick` line to `followup.log` that records the result — `stale-tick cancel=<found|not-found>` — and exit. Do not re-fetch or re-finalize.

**Orphan escalation — when no cancel ever reaches the cron, yet stale fires persist.** The signal is *reachability*, not a fire count. Once any cancel of this slug's cron has reported **found** — finalize's teardown cancel ([`finalize.md`](finalize.md) Step 4) or an earlier stale fire's defensive cancel — the cron was deletable in its runtime, so the fires that follow are the finite queued-drain backlog emptying: never escalate. The orphan is the opposite: the cron lives in a runtime neither the recorded id nor `CronList` can reach (a session continue / compaction severed every handle), so **every** cancel reports **not-found** and the fires keep arriving until the 7-day expiry. Escalate only when all three hold:

- this fire's defensive cancel reported **not-found**, **and**
- a prior `stale-tick` line for this slot already exists in `followup.log` — this is not the first stale fire, so it is not a lone drain, a manually-run tick, or a just-expired cron, **and**
- no `cancel=found` has ever been recorded for this slot (neither finalize's teardown line nor any earlier `stale-tick` line) — the cron was never reachable, so these fires are not a drained backlog.

Escalate to the owner **once**: if `followup.log` has no `stale-orphan-escalated` line, print one line — `orphaned cron: <slug> keeps firing after finalize; no in-session cancel can reach it — restarting the Claude session is the only clean clear` — and append a `stale-orphan-escalated` line so every later stale fire absorbs silently again. Never respond to an unreachable cron by guess-deleting ids `CronList` does surface: those belong to other live watchers, and deleting one silently kills a wanted loop.

Otherwise, self-record this watcher's cron id per [`record-cron-id.md`](record-cron-id.md) before proceeding. Recording every tick — while `CronList` can still see the cron — is what keeps the id a valid `CronDelete` target after a session continue / compaction blinds `CronList` to it, so teardown ([`finalize.md`](finalize.md), [`reconcile.md`](reconcile.md)) can always kill the orphan.

### Step 1 — Refresh PR state

Per [`../_shared/vcs/github/pr-metadata.md`](../_shared/vcs/github/pr-metadata.md). Update `prs.json[0].head_sha` and `prs.json[0].state` from the response; keep `mergeable` (conflict signal) for Step 5, and run the recipe's `compare` call to capture both `behind_by` (out-of-date signal) and `.base_commit.sha` — the base branch tip, Step 5's `base_tip_sha`.

### Step 2 — Termination check

If `state` is `MERGED` or `CLOSED`:

1. Finalize the slot per [`finalize.md`](finalize.md) — mark terminal, write `result.md`, log + telemetry, unschedule this watcher's cron.
2. Hand off the terminal wrap-up as the last action of the turn — for both `MERGED` and `CLOSED`:

   ```
   /muggle-do post-merge cleanup slug=<slug> state=<merged|closed>
   ```

   `/muggle-do` owns the worktree/branch knowledge: it runs teardown only on `merged` (honoring the `autoCleanup` gate — `closed` is unmerged, so the branch and any worktree stay intact), then suggests the next step. This is a runtime dispatch, not a doc dependency on `/muggle-do` — see the one-way rule in [`../CLAUDE.md`](../CLAUDE.md).
3. Exit. The watcher has unscheduled itself; no future ticks fire for this PR.


### Step 2.5 — Blocked-tick gate

Only when `last_seen.blocked` is present (the watcher is awaiting the owner on a durable human-block, flagged in Step 7). When absent, skip straight to Step 3.

Run the resume gate per [`blocked-tick.md`](blocked-tick.md): recompute the fingerprint; while it holds, stay blocked **silently** — the single owner reminder went out when the block was flagged — and clear the block and fall through to Step 3 the moment it moves. The block never changes the poll; it only mutes dispatch until the state the user must act on moves. A held block still exits through Step 7.5 — a cron-delivered blocked tick must not stay on a model-turn cadence either.

### Step 3 — Compute the actionable set from live thread state

The watcher's dispatch trigger is **derived from current provider state**, not a stored review-id cursor — see the [thread-state baseline design](../../../../muggle-ai-brain/architecture/2026-06-06-pr-followup-thread-state-baseline-design.md). Resolve the provider per [`../_shared/vcs/detect-vcs.md`](../_shared/vcs/detect-vcs.md), then:

- **`github`** — two sources, unioned:

  **(a) Actionable threads.** Fetch unresolved review threads per [`../_shared/vcs/github/unresolved-threads.md`](../_shared/vcs/github/unresolved-threads.md). A thread is **actionable** when `isResolved == false` **and** its newest comment lacks the loop marker `<!-- muggle-do:bot -->` — classify by the marker, never `author.login` (see [`../_shared/pr-followup-helpers/loop-signature.md`](../_shared/pr-followup-helpers/loop-signature.md)). Outdatedness is **not** a gate: a thread whose anchored line has since moved (a rebase or a later push to the branch) still carries its unanswered question, and dropping it leaves that question unanswered forever — the failure this trigger exists to prevent. Whether the moved code already mooted the concern is a judgment for `/muggle-do` to make and reply to, not a reason for the watcher to skip. The marker rule makes echo intrinsic: once the loop has replied, the thread's newest comment is the loop's own, so the thread is no longer actionable regardless of outdatedness — no cursor to advance, no self-recursion (see [`../_shared/pr-followup-helpers/echo-skip.md`](../_shared/pr-followup-helpers/echo-skip.md)).

  **(b) Actionable body-only reviews — GitHub only.** A body-only review — a submitted `CHANGES_REQUESTED`/`COMMENTED` review with no line comments — has no thread to derive state from, so it keeps a narrow watermark. GitLab has no review envelope (feedback is always a discussion note), so this sub-branch is GitHub-only and has no GitLab analogue. Fetch submitted reviews per [`../_shared/vcs/github/submitted-reviews.md`](../_shared/vcs/github/submitted-reviews.md); a body-only review is actionable when `id > last_seen.lastBodyReviewId` **and** `id ∉ last_seen.escalated_review_ids`.

  Collect the **owning review ids** for dispatch: for each actionable thread, the owning review of its newest comment (`pullRequestReview.databaseId` from the query); plus every actionable body-only review id. The dedup'd union is the dispatch list.

- **`gitlab`** — single source. Fetch unresolved discussions per [`../_shared/vcs/gitlab/unresolved-discussions.md`](../_shared/vcs/gitlab/unresolved-discussions.md) (drop to [`../_shared/vcs/gitlab/mr-discussions.md`](../_shared/vcs/gitlab/mr-discussions.md) for the raw notes if a thread's classification needs them). A discussion is **actionable** when it is unresolved **and** its newest note lacks the loop marker `<!-- muggle-do:bot -->` — same marker classification, never `author.username`. There is no body-only watermark: discussion state is the sole authority. The dispatch list is the **discussion ids** of the actionable discussions.

### Step 4 — If the actionable set is non-empty → dispatch (reviews preempt CI)

The watcher does **not** classify. Classification, batching, replying, escalation, and cycle execution all live in `/muggle-do`. The watcher hands over the dispatch ids from Step 3 (GitHub: owning review ids; GitLab: discussion ids) and exits — `/muggle-do`'s address-reviews re-derives the unresolved threads itself (its authority), so the watcher only needs to decide *that* there is work, not enumerate it exhaustively.

1. Reset `last_seen.idle_tick_count` to 0.
2. **Stop this watcher (single-thread).** Cancel its cron so no tick fires while the dev cycle runs, per [`cancel-cron.md`](cancel-cron.md). `/muggle-do` respawns the watcher when the cycle finishes — exactly one cron ever, and no tick overlaps a running cycle.
3. Dispatch `/muggle-do` with an *address-reviews* directive carrying:
   - PR URL (from `prs.json[0].url`)
   - Session slug (from the invocation arguments)
   - The dispatch ids from Step 3 (GitHub owning review ids / GitLab discussion ids), as a space-separated list

   Exact phrasing belongs to `/muggle-do`'s intent-routing. A reasonable shape is:
   ```
   /muggle-do address reviews <id1> <id2> ... on <pr-url> slug=<slug>
   ```
4. Append a dispatching line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md).
5. Emit a `tick` event with `actionable_threads: <count>`, `dispatched_review_ids: [<id>, ...]`.
6. Exit. **Reviews preempt CI** — when there is actionable feedback, this tick dispatches address-reviews and never polls CI. The watcher is now stopped; the dev cycle owns the PR and restarts the watcher when it finishes. (The watcher also self-unschedules in Step 2, terminal.)

### Step 5 — No actionable feedback → read the branch's standing against its base

A merge-ready branch is **current with its base** — neither conflicting nor behind. From the Step 1 metadata, the branch needs a rebase (`rebase_due`) when either:

- the branch **conflicts** with its base — the provider's conflict signal per [`../_shared/vcs/common/branch-standing.md`](../_shared/vcs/common/branch-standing.md), **or**
- `behind_by > 0` — out of date with the base. Read this from the `compare` call (commit ancestry), **never** from `mergeStateStatus == BEHIND`: GitHub masks `BEHIND` behind `DIRTY`/`BLOCKED` and only surfaces it under "require branches up to date" protection, so a stale PR that is also awaiting review or has a red required check reports `BLOCKED` — and its staleness would go unseen. The compare recipe for this — and each provider's conflict signal — is dispatched in [`../_shared/vcs/common/branch-standing.md`](../_shared/vcs/common/branch-standing.md).

`mergeable == UNKNOWN` with `behind_by == 0` is not due; `behind_by` is exact while GitHub is still computing conflict state, so a stale branch still counts.

This trigger is **independent of approval and CI state**: an out-of-date branch is rebased whether or not it has been reviewed, approved, or has green checks. The watcher acts on staleness directly — it never waits for an approval to surface it.

Rebase dedup is keyed on the **pair** `rebase_key = "<head_sha>..<base_tip_sha>"`, not on the head alone. Whether a branch conflicts is a function of both sides, so a head-only key wedges a PR permanently the first time the base moves: the head cannot change while nobody pushes, so one stale entry suppresses every genuinely new conflict that base movement introduces, forever. Take `base_tip_sha` from the Step 1 compare's `.base_commit.sha` (the base branch tip, which advances when the base does) — **never** `.merge_base_commit.sha`, which does not move when only the base advances and so would never re-arm.

Entries written by an older watcher are bare head SHAs with no `..`; the Step 6 verdict script ignores them, which re-arms any slot a head-only key had wedged.

`conflict_resolve_attempts` bounds one key, never the PR. Because `rebase_key` carries the base tip, every advance of the base mints a fresh key and hands the branch a fresh pair of attempts, so on an active base that budget can never stop anything. The per-PR budget is the one that binds: `last_seen.catch_up_rebases` counts every rebase this PR has been dispatched for, no key resets it, and [`../muggle-preferences/preference-gates/maxCatchUpRebases.md`](../muggle-preferences/preference-gates/maxCatchUpRebases.md) caps it at 20 by default.

### Step 6 — Poll CI for the head SHA, then take the verdict

Fetch the CI rollup for `prs.json[0].head_sha` per [`../_shared/vcs/common/ci-rollup.md`](../_shared/vcs/common/ci-rollup.md), provider resolved as in Step 3, and fold it into its bucket: `red`, `pending`, or `green` (green includes skipped checks and no checks).

Then run the verdict script. It is the **only** place this tick decides between dispatching and holding — never re-derive the decision from `last_seen.json` by reading it yourself. `<abs>` resolves from `${CLAUDE_PLUGIN_ROOT}/scripts/` as in [`arm-watcher.md`](arm-watcher.md); a slot with no `last_seen.json` feeds `/dev/null` instead:

```sh
node "<abs>/scripts/pr-watch-verdict.mjs" tick --pr-key "<owner>/<repo>#<n>" --head <head_sha> \
  --rebase-key "<head_sha>..<base_tip_sha>" --rebase-due <yes|no> --ci <red|pending|green> < "<slot>/last_seen.json"
```

It prints one line, `VERDICT=<verdict>`. A non-zero exit is a broken install: report it and stop, never improvise a verdict. What it applies, in order:

1. A rebase is due and `catch_up_rebases >= maxCatchUpRebases` (the cap from the user's preferences; the `rebase_budget_exhausted` flag is not consulted) → `block-rebase-budget-exhausted`.
2. A rebase is due, `conflict_resolve_attempts[rebase_key] < 2`, and `rebase_key` ∉ `conflict_escalated_keys` → `dispatch-rebase`. With the per-key budget spent — `conflict_resolve_attempts[rebase_key] >= 2` or `rebase_key` ∈ `conflict_escalated_keys` — it falls through to CI.
3. CI is `red`, `ci_fix_attempts[head_sha] < 3`, and `head_sha` ∉ `ci_escalated_shas` → `dispatch-fix-ci`. Red with `ci_fix_attempts[head_sha] >= 3` or `head_sha` ∈ `ci_escalated_shas` dispatches nothing — the fix budget is spent and the watcher does not re-dispatch; it holds as `block-ci-escalated` (Step 4) even when fix-ci never wrote the escalation, because idling there leaves a red PR with nobody told. A check still pending (`bucket == "pending"`) never dispatches: the tick idles until CI settles, and a green head idles too.
4. Otherwise `block-conflict-escalated`, `block-ci-escalated`, or `block-reviews-escalated` when the matching escalation stands, else `idle`.

**An escalation counts only with an attempt behind it.** An entry in `conflict_escalated_keys` suppresses a rebase only when `conflict_resolve_attempts[rebase_key] >= 1`, and an entry in `ci_escalated_shas` suppresses fix-ci only when `ci_fix_attempts[head_sha] >= 1`: a cycle ran and gave up. An entry with no attempt is ignored, and the work dispatches. Those fields are the executor's record of what its cycles did — never write an escalation entry or an attempt counter by hand.

**The verdict is binding.** The watch exists to drive the PR to merge-ready, and `autoRebase=always` means rebase without asking. How long a CI run or an eval takes is never a reason to hold a dispatch, and neither is a guess that the work is not worth it. The only hold is the user's own: a message they typed containing `HOLD WATCH #<pr-number>` for this PR. Asking them is allowed; answering a wake with a question instead of the dispatch is not. A Stop gate holds the turn open while work the watch recorded as due has no attempt behind it ([`../../hooks/README.md`](../../hooks/README.md)).

Act on the verdict:

- `dispatch-rebase` → dispatch and exit:
  1. Reset `last_seen.idle_tick_count` to 0.
  2. **Stop this watcher (single-thread):** cancel its cron exactly as in Step 4 — `/muggle-do`'s rebase respawns it when the cycle is done.
  3. Dispatch `/muggle-do` with a *rebase* directive (PR URL + slug; no review ids, no check names):
     ```
     /muggle-do rebase on <pr-url> slug=<slug>
     ```
     The executor rebases onto the base: a behind-only branch replays cleanly and force-pushes; a conflicting branch resolves behind the `autoResolveConflicts` gate. Both paths are `/muggle-do`'s — the watcher only decides *that* a rebase is due, never how.
  4. Append a dispatching line to `followup.log`; emit a `tick` event with `rebase_needed: true`, `dispatched_rebase: true`.
  5. Exit. The dev cycle owns the PR; its respawn restarts the watcher, whose next tick re-checks the branch against its base on the new head — the rebase is its own verify loop, bounded by the per-key attempt budget.
- `block-rebase-budget-exhausted` → the PR has spent its catch-up budget. Do **not** dispatch, and do **not** fall through quietly: set `last_seen.rebase_budget_exhausted` to `true`, block the watch with reason `rebase_budget_exhausted` (Step 7), and report the count, the cap and the preference key on the PR. Twenty rebases without converging is a branch its owner has to decide about — rebase it onto a different base, split it, or close it — and a watcher that merely stops leaves them to discover it days later. That block is the one reason a fingerprint move does not clear (Step 2.5): base movement is precisely what spent the budget, so resuming on it would restore the loop the cap exists to end. It clears when the owner raises `maxCatchUpRebases` or the PR goes terminal.
- `dispatch-fix-ci` → dispatch and exit:
  1. Reset `last_seen.idle_tick_count` to 0.
  2. **Stop this watcher (single-thread):** cancel its cron exactly as in Step 4 — `/muggle-do`'s fix-ci respawns it when the cycle is done.
  3. Dispatch `/muggle-do` with a *fix-ci* directive carrying the PR URL, slug, and the red check names (no review ids):
     ```
     /muggle-do fix ci <check-1> <check-2> ... on <pr-url> slug=<slug>
     ```
  4. Append a dispatching line to `followup.log`; emit a `tick` event with `checks_red: <count>`, `dispatched_ci_fix: true`.
  5. Exit. The dev cycle owns the PR; its respawn restarts the watcher, whose next tick re-checks CI on the new head SHA — CI itself is the verify loop.
- `block-conflict-escalated`, `block-ci-escalated`, `block-reviews-escalated` → blocked pending a human (Step 7).
- `idle` → transient idle (Step 7).

### Step 7 — Idle (remind when blocked pending a human)

Any tick that did not dispatch. The Step 6 verdict says **why** it idled. It is **blocked pending a human** on a `block-*` verdict, a durable block only the user can clear:

- `block-conflict-escalated` — a rebase `/muggle-do` attempted and gave up on (a semantic conflict, or `autoResolveConflicts=never`), reason `conflict_escalated`. This block clears on its own when the base moves: the new `base_tip_sha` yields a key the set does not contain, and the branch re-arms for a fresh rebase attempt;
- `block-ci-escalated` — CI the fix-ci stage gave up on, or a red head that spent all 3 fix-ci attempts, reason `ci_escalated`;
- `block-reviews-escalated` — an ambiguous review in `last_seen.escalated_review_ids` awaiting the user's direction, with the actionable set empty, reason `reviews_escalated`;
- `block-rebase-budget-exhausted` — reason `rebase_budget_exhausted` (Step 6).

`idle` is **transient** — green and waiting for the next review, CI still pending, or `mergeable == UNKNOWN` — and must keep the responsive `1m` cadence; those turn a state on their own and the watcher should catch it promptly.

**Transient idle** (no durable block): unchanged — increment `last_seen.idle_tick_count`, append an idle line to `followup.log` per [`output-templates/watcher-log.md`](output-templates/watcher-log.md), emit a `tick` event with `idle: true`, `blocked: false`, `actionable_threads: 0`, `dispatched_review_ids: []`, `rebase_needed: <bool>`, `dispatched_rebase: false`, `checks_red: <count or 0>`, `dispatched_ci_fix: false`. Exit through Step 7.5. The next tick fires from the loop that step leaves running ([`arm-watcher.md`](arm-watcher.md)).

**Blocked pending a human** (a durable block, and `last_seen.blocked` not already set): enter the blocked path per [`blocked-tick.md`](blocked-tick.md) — flag `last_seen.blocked` and emit the one-line owner reminder, **once per block**. From the next tick on, the Step 2.5 gate carries the block silently. Exit through Step 7.5.

### Step 7.5 — Leave one loop polling

Runs on every tick that idles — both Step 7 branches and a Step 2.5 held block. A loop exits on every report, so after a wake nothing polls the PR until this step arms one; a dispatching tick skips it, because the cycle's settle re-arms when the cycle ends.

Check the slot's `watch.pid` lease ([`state-schemas.md`](state-schemas.md#watchpid)):

- **Dead or missing** — arm per [`arm-watcher.md`](arm-watcher.md) and append a `re-armed` line to `followup.log`. The arm carries the slot's review, comment and thread floors forward, so anything that landed after this tick's read still reaches the session.
- **Live** — a loop already owns the cadence (this tick was not its wake). Nothing to arm.

When a **recovery cron** delivered the tick (`/loop` fired it), also cancel the cron per [`cancel-cron.md`](cancel-cron.md). Its job was to deliver *this* tick, never to become the poller: every cron fire is a full model turn, while the loop polls token-free at the same `1m` cadence.

Either way exactly one poller remains — the loop — and this tick was the only model turn spent.

## Output

The watcher stays invisible to the **GitHub reviewer** — it never posts to the PR from a tick. To the **loop owner** in the session it emits: the turn preamble, the one-line blocked reminder while awaiting the owner (Steps 2.5 / 7), and (when a dispatch fires) the `/muggle-do` invocation it made through the Skill tool. Nothing else.
