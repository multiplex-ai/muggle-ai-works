# Wave E2E — one run across a multi-repo wave

A multi-repo task ships as a **wave**: one PR per repo, all carrying parts of the same change. Testing each PR alone against the other repos' default branches tests a stack that will never exist — the frontend PR runs against a backend that lacks its new endpoint, and both walkthroughs report failures neither PR will have once the wave lands.

So a wave is tested as one: start every repo's service from its wave branch, run **one** E2E pass against the combined stack, and post that single result to every PR in the wave.

## When a cycle is a wave

What makes PRs a wave rather than a stream of independent changes is defined in [`wave-or-stream.md`](wave-or-stream.md): the PRs need each other to work. A wave additionally needs all of these, decided at pre-flight and recorded in `state.md`:

- Two or more repos carry changes this cycle.
- Each changed repo gets exactly **one** PR — no stacked PRs, no second PR in the same repo.
- Validation is `local-e2e`.
- Every wave repo that serves part of the stack can run locally. A repo that only ships a library or config consumed by another wave repo is still a wave member; it just contributes no service of its own.

Anything else is not a wave: each PR is a change of its own and runs Stage 6 on its own — in the background when other work is in flight, per [`background-e2e.md`](background-e2e.md). A wave can run in that background lane too, as one change: its brief carries every member ([`wave-or-stream.md`](wave-or-stream.md#the-acceptance-testers-brief)). Two PRs in one repo, or one repo whose service cannot start locally, fall back to per-PR runs — record the reason in `state.md` as `Wave: off — <reason>`.

## What pre-flight records

Under `## Pre-flight answers`, alongside `Repos:`:

```markdown
- Wave: on
- Wave members:
  - <owner/repo-a> → <worktree path a> (branch <branch>)
  - <owner/repo-b> → <worktree path b> (branch <branch>)
```

Stage 7 appends each member's PR number to its line once the PRs exist.

The worktree path is where that repo's wave branch is checked out — the path its service must start from. Record it per repo; never derive it later from the branch name.

## Stage 6 — run once for the whole wave

Run [`e2e-acceptance.md`](e2e-acceptance.md) **once**, not once per repo, with these changes:

1. **Start the wave stack.** Invoke [`muggle-test-prepare`](../muggle-test-prepare/SKILL.md) with the wave members as `directoryOverrides` (repo → worktree path): every service whose repo is a wave member starts from that member's worktree path, synced onto its base first, not from the repo's usual checkout. Services from repos outside the wave start from that repo's base checkout on its latest default branch.
2. **Confirm each wave service runs the wave branch.** A port that answers is not enough — the process on it may be a dev server the user left running from the default checkout. Check the readiness table: every wave service must report its member's worktree as its `Source`, at that worktree's current HEAD. A service that doesn't → halt and escalate with the table; never test a wave against a service running another branch.
3. **Merge every member's scope.** Steps 1.5–3 read impact analysis for every wave repo, and the run's scope is the union of each member's `e2eScope`: a test case several members scope runs once, and a new case two members plan for the same criterion is created once. `EMPTY_DIFF` applies only when every member's diff is empty.
4. **Run each selected test case once** against the combined stack. Do not repeat a case per repo.
5. **Attribute failures.** For each Failed entry, name the member whose change the failing step implicates (`implicatedRepo: <owner/repo>`), or `unknown` when the evidence does not point at one. Stage 7.5 repairs in that repo.

The report carries one extra metadata block:

```markdown
**Wave:**
- <owner/repo-a> @ <head sha> → PR #<n> (filled in at Stage 7)
- <owner/repo-b> @ <head sha> → PR #<n>
```

The SHAs are what the run tested. A result is only valid for the PRs at those SHAs.

## Stage 7 — post the same result to every PR

[`open-prs/forward.md`](open-prs/forward.md) runs per repo as usual, with the wave ordering:

1. **Open every PR first**, before settling any walkthrough. Each PR's walkthrough names its siblings, so all PR numbers must exist before the first one is written.
2. **Body.** Add a `## Wave` section to each PR's body, after `## Validation`: one line per sibling PR (`owner/repo#n`), and the line `Tested together — merge all PRs in this wave together.`
3. **Title.** Every PR in the wave takes the same E2E prefix. A wave run with failures retitles every member `[E2E FAILING]`, not only the implicated one — the run tested them as one change.
4. **Walkthrough.** Settle each PR's designated walkthrough comment with the **same** E2E report through [`muggle-pr-visual-walkthrough`](../muggle-pr-visual-walkthrough/SKILL.md) Mode A, passing that PR's number and repo explicitly — Mode A otherwise looks up the PR from the current branch, which in a multi-repo cycle is the wrong repo. The runs, screenshots, and dashboard links are identical on every PR; only the PR it is posted to differs. A `SKIPPED` wave run is re-declared from each member's worktree in turn: a declaration settles only the PR of the tree it runs in.
5. **Record the PR numbers** on the `Wave members` lines in `state.md` (`… (branch <branch>) → PR #<n>`), so a later cycle on any one PR can find its siblings. Every slot a wave PR's watcher runs from gets the same `Wave` block.

## Stage 7.5 — repair across the wave

[`e2e-repair.md`](e2e-repair.md) runs once for the wave, not per PR:

- A `repair` disposition fixes the code in the failure's `implicatedRepo`. An `unknown` attribution is `ask`, never a guess at a repo.
- After any pass, re-run the wave E2E above (same stack, the touched member's service restarted on its new commit) over the affected test cases, then refresh **every** wave PR's walkthrough and title through [`open-prs/update.md`](open-prs/update.md) — the evidence changed for all of them, even the PRs whose code did not.
- Clearance holds for the wave as a whole. Stage 8 dispatches one watcher per wave PR only once the wave clears.

## Later cycles on one wave PR

When the watcher dispatches an address-reviews or fix-ci cycle on one PR whose `state.md` records `Wave: on`:

- A full cycle ([`cycle-size.md`](cycle-size.md)) re-runs the wave E2E in Stage 6, with every sibling's service started from its PR's current head — not from the default branch. Fetch each sibling's head into its recorded worktree first.
- Post the new result to the PR under review and refresh each sibling's walkthrough too, since the run tested them together and the earlier result on the siblings is now stale.
- A minor cycle runs no E2E. Its `NO_APP_LOGIC_CHANGE` skip settles only the PR under review, with the wave's last run kept beneath it, and the siblings' walkthroughs stay as they are: no app logic changed, so that run still describes the whole wave.
- A sibling already merged or closed leaves the wave: test against the base branch for that repo, and drop it from the `## Wave` section on the next refresh.

## Invariants

- One E2E run per full wave cycle, none for a minor one; never one per repo.
- Every wave service starts from its member's worktree, verified by process cwd — a listening port proves nothing about the branch.
- Every wave PR carries the same walkthrough, the same E2E title prefix, and a `## Wave` section naming its siblings.
- Not a wave → each PR runs Stage 6 alone, with the reason recorded.
