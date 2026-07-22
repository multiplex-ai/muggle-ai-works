# Watch mode — the Monitor-armed poller

How a watcher is armed so that a quiet PR costs nothing. The detector is [`poll.sh`](poll.sh), a shell script with no LLM in it; it runs under the harness `Monitor` tool and prints a line only when the PR needs work. Every printed line becomes one turn in the session that armed the watcher — silence is the cheap path, and the poller is built to stay silent.

## Why the poller is not a turn

A `/loop`-driven tick is a turn in the arming session. That turn re-reads the whole session transcript as prompt-cache tokens before it does any work, and it runs on the session's model — which makes the `model:` pin in [`SKILL.md`](SKILL.md) inert, since a cron-dispatched skill never gets to override the session that hosts it. A minute-cadence watcher therefore bills a full session's context every minute for the overwhelmingly common answer: nothing changed.

`poll.sh` moves the *detection* out of the model entirely. The model is re-entered only on a state change, which is where its judgment was needed in the first place.

## Arming

Launch one monitor per PR, as the last action of the arming turn:

```
Monitor(
  command: bash "${CLAUDE_PLUGIN_ROOT}/skills/muggle-pr-followup/poll.sh" --slug <slug> --repo <owner>/<repo> --number <n>,
  description: "<owner>/<repo>#<n> — review, CI, and rebase events",
  persistent: true,
)
```

`persistent: true` is required: the watcher's lifetime is the session's, and a default-timeout monitor would silently stop mid-PR. Stop a watcher with `TaskStop`, never by letting it time out.

The poller needs `gh` (authenticated) and `jq` on `PATH`; it emits `ERROR` and exits if either is missing. It reads `~/.muggle-ai/muggle-do/sessions/<slug>/last_seen.json` for the attempt budgets and watermark, and writes back only `idle_tick_count` — a whole-file rewrite through a temp file and an atomic rename, per [`state-schemas.md`](state-schemas.md#last_seenjson).

## Emitted line grammar

Every line is `MUGGLE-WATCH <slug> <KIND> <payload>`. At most one line per iteration.

| Line | Payload | Meaning |
| :--- | :------ | :------ |
| `REVIEWS <id> [<id>…]` | owning review ids, space-separated | Actionable feedback: unresolved, non-outdated threads whose newest comment lacks `<!-- muggle-do:bot -->`, plus body-only reviews above `lastBodyReviewId` and outside `escalated_review_ids`. |
| `REBASE <head_sha>..<base_tip_sha>` | the `rebase_key` | `behind_by > 0` or `mergeable == CONFLICTING`, with `conflict_resolve_attempts[key] < 2` and the key outside `conflict_escalated_keys`. |
| `CI <name> [\| <name>…]` | red check names | Checks settled with at least one `bucket == "fail"`, `ci_fix_attempts[head_sha] < 3`, and the head outside `ci_escalated_shas`. |
| `TERMINAL <merged\|closed>` | final PR state | The poller exits 0 immediately after. |
| `ERROR <reason>` | short reason | The poller could not read PR state. It keeps polling. |

Check names are separated by ` | ` rather than spaces because a GitHub check name routinely contains spaces (`unit (node 22)`); the other payloads have no such ambiguity and stay space-separated.

**Precedence.** Reviews preempt rebase, which preempts CI — the same order as [`contract.md`](contract.md) Steps 4 → 5 → 6. An iteration that emits `REVIEWS` never looks at the branch or the checks.

**Repeat suppression.** An unchanged actionable state is reported once, not once a minute. The poller holds the signature of what it last emitted and stays quiet until that signature moves — a new review id, a new head or base tip, a different set of red checks. Suppression resets the moment an iteration goes fully idle, so a recurrence is reported again.

## Coverage — what silence does and does not mean

Silence means "nothing actionable this minute," and only that. The poller emits on the two states that would otherwise be indistinguishable from a quiet PR:

- **Terminal PR** — `TERMINAL merged` / `TERMINAL closed`, then exit. A finished PR never leaves the monitor idling forever.
- **Its own failure** — `ERROR` on a `gh` call that fails or returns something unparseable. A transient failure does not kill the loop; the next iteration retries. The first failure in a run reports immediately, then repeats are throttled to every tenth consecutive failure so a revoked token or a dead network cannot storm the session into Monitor's noisy-monitor auto-stop.

Every iteration also appends one line to the slot's `followup.log`, whether or not it emitted. That heartbeat is what [`reconcile.md`](reconcile.md) reads to decide a watcher is still alive — without it the sweep would treat a healthy Monitor-armed slot as a dropped respawn and arm a second watcher on top of it.

## From an emitted line to a tick

An emitted line is a notification, not a dispatch. Handle it as one turn:

1. Confirm the line's slug matches a live slot. A line for a slot that has `result.md` is stale — `TaskStop` the monitor and do nothing else.
2. Run [`contract.md`](contract.md) from **Step 1**, using the emitted line to select the branch: `REVIEWS` → Step 4, `REBASE` → Step 5, `CI` → Step 6, `TERMINAL` → Step 2 ([`finalize.md`](finalize.md)). The payload is a hint about *what* changed; the contract re-derives state itself and remains the authority.
3. Step 0's cron bookkeeping ([`record-cron-id.md`](record-cron-id.md)) is a no-op under this substrate — there is no cron id to record, and `cron.json` keeps `cron_id: null`.
4. Where Steps 4 / 5 / 6 say to stop the watcher before dispatching, `TaskStop` the monitor instead of cancelling a cron. Everything else about the dispatch is unchanged.

Step 4 is not optional. The dispatch contract's single-thread rule assumes the watcher is stopped for the duration of the cycle, and the restart at the end of a cycle arms a cron — so a monitor left running would sit alongside that cron as a second watcher on the same PR. Stopping it keeps exactly one watcher alive at all times. A PR therefore polls on the monitor substrate until its first dispatch and on the cron substrate afterwards, until the next bootstrap or reconcile re-arms it; the cost win is on the idle watchers, which is where the cost was.

## Relationship to the cron substrate

The cron machinery — [`reconcile.md`](reconcile.md), [`cancel-cron.md`](cancel-cron.md), [`record-cron-id.md`](record-cron-id.md), `cron.json` — is untouched and still load-bearing. It covers slots armed before this change, and it is the recovery path for a slot whose monitor died with its session: reconcile finds a stale `followup.log`, re-arms a `1m` cron, and that watcher runs the same [`contract.md`](contract.md) tick. Recovery lands on the older, more expensive substrate by design — a watching PR beats a cheap one.

Stop semantics are unchanged. A watcher stops on a terminal PR or an explicit ask from the user, never on its own cost.
