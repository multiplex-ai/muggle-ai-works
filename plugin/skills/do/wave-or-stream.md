# Wave or stream — how a session's PRs group into changes

A session that opens more than one PR has opened a **wave**, a **stream**, or both, and each is tested differently. The grouping decides how many E2E runs the session owes and which report each PR carries, so it is settled once, at pre-flight, and every later stage reads it from `state.md`.

## Wave

One change split across repos. The PRs only work together: the frontend PR calls an endpoint the backend PR adds; a library PR ships a type its consumers adopt in theirs.

- One PR per repo, all carrying parts of the same change.
- **One** E2E run against the combined stack, every service started from its member's branch. The same report goes on every PR in the wave, and they merge together.
- Procedure: [`wave-e2e.md`](wave-e2e.md).

## Stream

Unrelated changes that ship in the same session: separate bugs, separate tasks. Each PR stands alone — it would pass review and work in production if none of the others ever merged.

- Each PR is its own change, with its own session directory, branch, worktree, E2E run and report.
- Each run goes to a background acceptance-tester while the session moves on, one local run at a time.
- Procedure: [`background-e2e.md`](background-e2e.md).

A session can hold both. A wave for one feature, opened alongside unrelated fixes, is one change in the stream: it gets one wave run, and each fix gets its own.

## Deciding

For each pair of PRs, ask whether either needs the other to work.

| Answer | Grouping |
| :----- | :------- |
| Yes, and they are in different repos | Same wave |
| Yes, and they are in the same repo | A stack, not a wave: each PR is tested on its own branch, which already carries the PRs beneath it |
| No | Separate changes in the stream |

A wave also needs every serving repo to run locally ([`wave-e2e.md`](wave-e2e.md#when-a-cycle-is-a-wave)). Interdependent PRs whose stack cannot start together are tested per PR; record why as `Wave: off — <reason>`.

**When unsure, treat them as a stream.** A stream PR that needed a sibling fails visibly, and its repair loop names the missing piece. A wave that should have been a stream puts one change's report on another change's PR — the evidence reviewers trust most, vouching for code it never ran.

## Recording

Pre-flight writes the grouping into `state.md`; no later stage re-derives it from branch names or diffs.

- **Wave** — one session directory for the wave, with `Wave: on` and its `Wave members` block ([`wave-e2e.md`](wave-e2e.md#what-pre-flight-records)).
- **Stream** — one session directory per change, each listing the others under `Sibling changes`.

A change that grows a second repo mid-cycle has become a wave: record the new member before Stage 6, never after a run has already been posted per PR.

## The acceptance-tester's brief

A background run tests exactly one change, so its brief names exactly that change's PRs ([`background-e2e.md`](background-e2e.md#brief)):

- **A stream change** — its one repo, worktree, branch, head SHA and PR.
- **A wave** — every member's repo, worktree, branch, head SHA and PR. The agent starts the combined stack per [`wave-e2e.md`](wave-e2e.md) Stage 6, reports `Tested:` once per member, and names each failure's `implicatedRepo`.
