# Session State Schemas

Canonical shapes for the JSON files in a PR-follow-up session slot. The slot path is `~/.muggle-ai/muggle-do/sessions/<slug>/` (under the user's home, shared across repos; `muggle-do` is the current and only caller).

All files are **whole-file atomic writes** — rewrite the entire file each time, never a partial edit. See [Writing state files](#writing-state-files) for the exact mechanism.

## Writing state files

Apply every `increment` / `reset` / `set` / `append` the procedures call for as a **whole-file rewrite** — `jq` to a temp file, then `mv` — so untouched fields survive and the write is atomic:

```bash
f=~/.muggle-ai/muggle-do/sessions/<slug>/last_seen.json
key=$(jq -r 'keys[0]' "$f")          # the single "<owner>/<repo>#<n>" key
tmp=$(mktemp)
jq --arg k "$key" '.[$k].idle_tick_count += 1' "$f" > "$tmp" && mv "$tmp" "$f"
```

Per mutation kind — substitute the field, add the `--arg` it needs:

| Kind | `jq` filter |
| :--- | :---------- |
| increment counter | `.[$k].idle_tick_count += 1` |
| reset counter | `.[$k].idle_tick_count = 0` |
| set scalar | `.[$k].last_pushed_sha = $sha` (`--arg sha "$new_sha"`) |
| append to array | `.[$k].pushed_shas += [$sha]` |
| bump per-SHA map entry | `.[$k].ci_fix_attempts[$sha] = ((.[$k].ci_fix_attempts[$sha] // 0) + 1)` |

`prs.json` is a one-element array — key on `.[0]`: `jq --arg sha "$h" --arg st "$s" '.[0].head_sha = $sha | .[0].state = $st' "$f" > "$tmp" && mv "$tmp" "$f"`.

**Never patch these files with the Edit tool.** On-disk formatting is not guaranteed to match the shapes shown below — a writer may emit them single-line — so an `old_string` shaped on the documented form silently fails to match, the edit is dropped ("malformed edit"), and the counter never advances. `jq` and Write ignore formatting and can't miss. If `jq` is unavailable, Read the whole file and rewrite it with Write — still never a partial Edit.

## Legacy location

Before the move to the user's home, slots lived at the repo-relative `.muggle-do/sessions/<slug>/` (one per working tree, still gitignored). Bootstrap's Step 5 migrates a legacy slot to the home-dir location on the next run for that PR; nothing else reads the old path. The state is ephemeral and reconstructible from GitHub, so an un-migrated slot costs only a re-bootstrap, not data.

## `prs.json`

A list of one entry. (Historical: the file is an array for forward-compat with the original session-wide model. Today, each PR has its own session slot, so the array always has exactly one entry.)

```json
[
  {
    "repo": "<owner>/<repo>",
    "provider": "github" | "gitlab",
    "number": <int>,
    "url": "https://github.com/<owner>/<repo>/pull/<number>",
    "head_sha": "<40-char-hex-sha>",
    "state": "open" | "merged" | "closed"
  }
]
```

- `provider` selects the recipe set (`gh` vs `glab`). Absent ⇒ `github` — existing slots predate the field and stay GitHub.
- Under GitLab, `number` holds the MR `iid` (per-project, not the global MR id); `head_sha` is unchanged. GitLab's `opened` normalizes to `open`; `merged` and `closed` already align.
- `state` is the **observed** state from the last `gh pr view`. The watcher refreshes it each tick.
- Terminal states (`merged`, `closed`) are sticky — once set, the watcher writes `result.md` and exits without rescheduling.

## `last_seen.json`

Keyed by `"<owner>/<repo>#<n>"`. One key per PR in the slot.

```json
{
  "<owner>/<repo>#<n>": {
    "lastBodyReviewId": <int>,
    "last_pushed_sha": "<sha-or-null>",
    "idle_tick_count": <int>,
    "cycles_completed": <int>,
    "escalated_review_ids": [<int>, ...],
    "pushed_shas": ["<sha>", ...],
    "ci_fix_attempts": { "<sha>": <int> },
    "ci_escalated_shas": ["<sha>", ...],
    "conflict_resolve_attempts": { "<sha>": <int> },
    "conflict_escalated_shas": ["<sha>", ...]
  }
}
```

- `lastBodyReviewId`: narrow watermark for **body-only** reviews (a submitted review carrying no line comments). The watcher dispatches a body-only review only when `id > lastBodyReviewId`. Line-comment threads do **not** use it — they are dispatched from live thread state (unresolved + not outdated + newest comment unmarked by the loop), so there is no cursor that can pin past them. Bootstrap sets it to the highest existing submitted review id with `--forward-only`, else `0`. The cursor keeps its name under GitLab, where it holds the highest note / discussion id.
- `last_pushed_sha`: most recent SHA `/muggle-do` pushed in this PR's life; `null` until the first push.
- `idle_tick_count`: incremented each tick whose actionable set is empty. Reset to 0 on any tick that dispatches `/muggle-do`. Diagnostic only — does not gate behavior.
- `cycles_completed`: incremented each time `/muggle-do` completes an address-reviews invocation (regardless of actionable/ambiguous/mixed).
- `escalated_review_ids`: review ids classified as ambiguous by `/muggle-do`. The watcher excludes these from the actionable set (both body-only reviews and the threads they own) so the same ambiguous review is never re-dispatched.
- `pushed_shas`: every SHA `/muggle-do` has pushed for this PR. Append-only. Used by the resolve-reminder stage to recognize threads addressed by the loop.
- `ci_fix_attempts`: per-SHA count of fix-ci cycles `/muggle-do` has run. The watcher stops dispatching fix-ci for a SHA once its count reaches 3. Keyed by head SHA.
- `ci_escalated_shas`: head SHAs whose CI the fix-ci stage gave up on (attempts exhausted or only out-of-scope checks). The watcher excludes these from CI dispatch so a hopeless SHA is never re-fixed.
- `conflict_resolve_attempts`: per-SHA count of rebase cycles `/muggle-do` has run for this SHA (behind-only or conflicting — both rebase onto the base). The watcher stops dispatching a rebase for a SHA once its count reaches 2. Keyed by head SHA. A clean behind-only rebase produces a new SHA, so the cap only bites a SHA that keeps failing to rebase-and-verify.
- `conflict_escalated_shas`: head SHAs whose rebase `/muggle-do` gave up on (attempts exhausted, or a conflict under `autoResolveConflicts=never`). The watcher excludes these from rebase dispatch so a hopeless SHA is never re-attempted.

## `state.md`

Free-form markdown. No required schema beyond a few well-known fields the caller-agnostic code reads:

```markdown
# Session — <slug>

**PR:** <url>
**Slug:** <slug>
**Loop user:** <github-login>          ← cached from `gh api user`
**Created:** <ISO-8601>
**Bootstrapped from URL:** <yes | no>

## Pre-flight answers

- Validation: <local-e2e | staging-replay | unit-only | skip>
- Local URL: <url | N/A>
- Backend status: <up | down | N/A>
- Muggle Test project: <name> (<uuid>)
- Test credentials: <existing | new | skip>
- Auth status: <ok | re-authed | N/A>
- Working tree: <path>

...free-form notes added by /muggle-do and bootstrap...
```

The `## Pre-flight answers` block is the **E2E validation context** consumed by `do/e2e-acceptance.md` Step 0 — seeded by bootstrap (Step 6.5) or by pre-flight's output block. Fields: [`../_shared/resolve-e2e-validation-context.md`](../_shared/resolve-e2e-validation-context.md#persisted-fields).

The watcher does **not** read or write `state.md`. Only bootstrap, `/muggle-do`, and the caller's stages touch it.

## `followup.log`

Append-only line-per-tick log. One line per watcher tick, plus one line per `/muggle-do` invocation. Format is loose, but each line starts with an ISO-8601 timestamp:

```
2026-05-20T12:34:56Z tick pr=154 threads=0 idle
2026-05-20T12:35:56Z tick pr=154 threads=1 dispatched=4295962800
2026-05-20T12:36:14Z muggle-do cycle review_ids=[4295962800] outcome=pushed head_sha=abc1234
```

Used for forensics only — never read back by skills.

## `result.md`

Written exactly once when the PR's watcher exits terminally (PR merged or closed). Free-form markdown summarizing the PR's life under this loop:

```markdown
# Result — <slug>

**PR:** <url>
**Final state:** merged | closed
**Cycles completed:** <int>
**Pushed SHAs:** <comma-separated list>
**Escalated review ids:** <comma-separated list or "none">

## Timeline

- <ISO-8601> bootstrap (lastBodyReviewId <id>; line-comment threads state-derived)
- <ISO-8601> review <id> from <login> — actionable, pushed <sha>
- <ISO-8601> review <id> from <login> — ambiguous, escalated
- ...
- <ISO-8601> PR <merged|closed> — watcher terminal
```

## Not in the slot

`cycle.json` and `requirements.md` are not seeded or read. `/muggle-do` reads reviews off GitHub each invocation.
