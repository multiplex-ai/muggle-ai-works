# Background E2E — one acceptance run per change, off the main thread

A session that fixes several unrelated bugs opens several PRs, and each needs the E2E run of its own change: a walkthrough rendered from another change's run vouches for code that run never exercised. Running each Stage 6 inline also stalls the session on the browser while the next fix waits. So each change's Stage 6 runs in a background `muggle:acceptance-tester`, and the main session moves on to the next change.

## Changes

A **change** is what gets one E2E run and one report: a whole wave, or one PR of a stream. How a session's PRs group into waves and streams is defined once, in [`wave-or-stream.md`](wave-or-stream.md); this lane runs every change of a stream, a wave included.

- Each change has its own session directory (`state.md`, `iterations/`), branch and worktree — one per member for a wave. Pre-flight splits a request that bundles unrelated fixes this way ([`pre-flight.md`](pre-flight.md)).
- Changes cannot share a checkout: the background run tests one change's tree while the session edits another's. Every change gets a worktree, whatever `autoUseWorktree` says.

## Lane

`state.md` records the lane Stage 6 runs in:

- `E2E lane: background` — the session has other work in front of it when this change reaches Stage 6: another change still being built, queued, or in its own run.
- `E2E lane: inline` — a lone change with nothing else to do. Handing it off buys nothing and costs the run the session's context.

Decide the lane when the change reaches Stage 6, not at pre-flight; a change that ran inline in an earlier cycle can run in the background now.

## One local run at a time

Local runs share one studio browser and the stack's ports, and two studio runs at once corrupt each other — both report infra failures that read as product signal. So:

- At most one local acceptance-tester is in flight from this session. Further changes queue in the order they reached Stage 6.
- No inline local run starts while a background one is in flight, and the main session neither starts nor stops services meanwhile — the agent owns the local stack for its run.
- A run against a preview or staging URL drives the cloud rather than the local studio and needs no queue.

Each change's `state.md` tracks its place: `E2E dispatch: queued` → `running — dispatched <ISO-8601>` → `reported — <verdict> (<runIds>)`.

## Brief

The agent knows only its brief. Pass every value itself, never a pointer to the conversation:

- The change's slug and absolute session directory.
- Repo, worktree path, branch, base branch, and the head SHA under test — for a wave, one entry per member, from its `Wave members` block.
- The change's PR URL — for a wave, every member's. Stage 5.5 opened it before this run; only an `autoCreatePR` skip leaves none. Muggle reads PR URLs from the brief to know which PR's walkthrough is waiting on this run, so leave none out and add none that belong to another change.
- `Validation`, `localUrl`, `projectId`, and test-credential status from `state.md`.
- The `e2eScope` from impact analysis, verbatim; a Stage 7.5 re-run passes only its affected test cases.
- The acceptance criteria from `requirements.md`.
- `wallTimeBudgetSec`.
- The absolute path of [`e2e-acceptance.md`](e2e-acceptance.md) as the stage to execute — plus [`wave-e2e.md`](wave-e2e.md) for a wave — with the rules in the two sections below.

Dispatch it as `subagent_type: "muggle:acceptance-tester"` (bare `acceptance-tester` where the plugin namespace is absent), in the background. A harness with no background agents runs every change's Stage 6 inline, one after another.

## The agent's run

1. Start the stack from the change's worktree: [`muggle-test-prepare`](../muggle-test-prepare/SKILL.md) with the worktree as the directory override for the repo's services — for a wave, every member's worktree for its own repo's services, per [`wave-e2e.md`](wave-e2e.md) Stage 6. Confirm by process cwd that each service runs its worktree — a port that answers may be serving another change's branch.
2. Execute `e2e-acceptance.md` from Step 0.5 through Step 7 over the brief's scope, in its own context. A wave runs each case once against the combined stack and names each failure's `implicatedRepo`.
3. Append the Stage 6 marker to the change's `iterations/<NNN>.md`: that file's report, plus `Tested: <owner/repo>@<sha>` — one line per member for a wave.
4. Return the same report as its final message.

## What the agent never does

- Dispatch another agent or fork. It runs every step itself; a re-delegated run escapes the queue and lands on the browser alongside the next one.
- Edit code, commit, push, open or edit a PR, post or edit a comment, or arm a watcher. Every PR write stays in the main session, the one place that knows which change a PR belongs to. The one exception is the run's [PR progress](../_shared/dev-loop/run.md#pr-progress) — the `muggle e2e-plan` post and the per-case rows its execute hooks fill — which writes only to the walkthrough slot of the PR on the worktree's own branch.
- Declare a skip marker. A `SKIPPED` verdict returns its code; the main session declares it from the PR's worktree, where it is verified and where it settles that PR alone.
- Stop the stack it started.

## When the report returns

On the agent's completion notification, the main session:

1. **Checks freshness.** Every `Tested:` line must name its branch's current head. A branch that moved since dispatch — any member's, for a wave — makes the report stale: queue the change again and post nothing.
2. **Records it** — `E2E dispatch: reported — …` in `state.md`.
3. **Continues that change from Stage 7**, in its worktree. [`open-prs/forward.md`](open-prs/forward.md) settles the walkthrough of the PR Stage 5.5 opened with this report — every member's PR for a wave, per [`wave-e2e.md`](wave-e2e.md) Stage 7 — through Mode A with its number and repo passed explicitly, never from the current branch, since the session's cwd may be another change's worktree.
4. **Runs Stage 7.5** inline. A repair pass's re-run returns to this lane, behind any local run in flight.
5. **Arms the change's watcher** once 7.5 clears (Stage 8).
6. **Dispatches the next queued change.**

An agent that ends without a report is dispatched once more; a second miss runs that change's Stage 6 inline.

## PRs opened outside `muggle-do`

A session that fixed bugs by hand and opened each PR itself follows the same lane, one acceptance-tester per PR. With no pre-flight or impact analysis, the main session resolves the run first: `muggle-test`'s change detection and test-case selection over that PR's diff against its base, its questions answered in the main session — the agent has no user to ask. The brief then carries the selected test cases, project and URL in place of `e2eScope`, and names [`../_shared/dev-loop/run.md`](../_shared/dev-loop/run.md) as the procedure. The main session posts the returned report to that PR through [`muggle-pr-visual-walkthrough`](../muggle-pr-visual-walkthrough/SKILL.md) Mode A, number and repo explicit.

## Enforcement

- Dispatching a background acceptance-tester holds the E2E and debug-path Stop gates off for a bounded window, and for that window the walkthrough and watch gates set aside the PRs its brief names — the session is never steered into a second browser run alongside the agent's, nor into arming a watch on a PR whose run has not come back.
- A walkthrough posted to one PR settles that PR only; every other PR the session opened is still checked for its own.
- A skip declaration settles only the PRs of the change it is declared in — the working tree's repo and branch: the PRs opened for that branch and its branch's PR, never another change's, wherever the session's directory sat when a PR was opened.
- Every PR's walkthrough check stays red until its slot is settled, so a change whose run never came back cannot pass as tested.

## Invariants

- One run and one report per change per full cycle; a wave is one change.
- At most one local acceptance run in flight from the session.
- Every PR write happens in the main session, save the run's PR progress to its own branch's walkthrough slot.
- A report settles only the PRs of the change it tested, at the SHA it tested.
