# Design Agent (Stage 2.5)

Finalize the change's design before any code. Stage 3 never edits a file until `state.md` carries a `Design: finalized` line. This stage writes it for the paths that need no approval; for the rest the approval is the merge of a design PR, and [`cleanup.md`](cleanup.md) writes it when that PR merges.

## Turn preamble

```
**Stage 2.5 — Design** — writing the spec and holding the build until its design PR merges.
```

## Inputs

- `requirements.md` from Stage 2.
- `state.md` from pre-flight.

## Which path

0. **Already decided.** `state.md` already carries a `Design:` line — a resumed session, or a re-entry from address-reviews, fix-ci or E2E repair.
   - `Design: finalized` → the stage is closed: reopen nothing, write no `design.md`, ask nothing, and go on to Stage 3. The line is the record of the decision; a missing `design.md` or an approval not shown in this conversation does not make it doubtful.
   - `Design: pending` → the design PR it names is still open. Open no second PR, ask nothing, and end the turn per [Waiting for the merge](#waiting-for-the-merge).
   - `Design: rejected` → the design PR closed unmerged. Build nothing; report the closed PR and end the cycle.
1. **Spec supplied.** The task itself is a design or spec the user wrote — a linked or pasted doc that already decides the approach. It is final as given: record `Design: finalized — user-supplied spec <path or link>`, write no `design.md`, and ask nothing.
2. **Trivial change.** One file, or a few lines across files, with no design surface: no new module, interface, data shape, or behavior a reasonable reader could build two ways. `requirements.md` is the whole spec: record `Design: finalized — trivial, requirements.md is the spec (<one-line reason>)` and ask nothing. When unsure, it is not trivial.
3. **Approved in pre-flight.** A pre-flight answer that already approved a stated approach: record `Design: finalized — approved in pre-flight (<the answer>)` and ask nothing.
4. **Everything else** goes through the design PR below.

## Design PR

The design is approved by merging a PR that carries it, never by a prompt. This stage calls no `AskUserQuestion`.

1. **Write the spec** to `~/.muggle-ai/muggle-do/sessions/<slug>/design.md`, using superpowers' design step to reach it. Sections: approach, what changes where (components and files), decisions with the alternative each one rejected, what is out of scope. Every decision is made and stated — no open options handed back.
2. **Place it.** The doc's home is the location the project's agent instructions (`CLAUDE.md`, `AGENTS.md`) name for design docs — which may be another repo — else `docs/designs/<slug>.md` in the change's repo. Create a worktree of the home repo from `origin/<default branch>` per [`../_shared/use-worktrees.md`](../_shared/use-worktrees.md), on branch `<Branch from state.md>-design`, copy the spec to the home path, and commit it as `docs(design): <goal>`.
3. **Open the PR.** Push per [`../_shared/vcs/common/push-to-branch.md`](../_shared/vcs/common/push-to-branch.md), then create it with the provider recipe of [`open-prs/forward.md`](open-prs/forward.md) Stage 5.5 Step 5 — ready for review, never a draft. Title `[DESIGN] <goal>`. Body, signed per [`../_shared/vcs/post-signature.md`](../_shared/vcs/post-signature.md): `## Goal`, `## Decisions` (one line per decision), and the line `Merging this PR approves the design and starts the build. Closing it unmerged rejects the design.`
4. **Settle its walkthrough.** A design doc has no app surface. From the design worktree: `echo "MUGGLE_E2E_SKIP: NOT_APPLICABLE: design document only — merging it approves the design"`.
5. **Seed the design slot** `~/.muggle-ai/muggle-do/sessions/<slug>-design/`: `state.md` with the build slot's `## Pre-flight answers` block, `Validation` replaced by `skip — design document only`, `Branch` by the design branch, plus `Design PR for: <slug>` and `Design doc: <home path>`; then `prs.json` and `last_seen.json` as [`open-prs/forward.md`](open-prs/forward.md) Stage 5.5 Step 6 seeds them, **without** `forward_stages_in_flight` — no run is in flight, so nothing holds. Arm its watch per [`../muggle-pr-followup/arm-watcher.md`](../muggle-pr-followup/arm-watcher.md).
6. **Record** `Design: pending — design PR <url>` in the build slot's `state.md`, and notify the user with a push notification where the host has one: `Design PR open for <slug> — merge it to start the build`.

## While the PR is open

- **Review comments** reach the design slot's watcher like any PR's and dispatch address-reviews on it. [`build.md`](build.md) edits only the design doc there, and the docs-only diff sizes as a minor cycle ([`cycle-size.md`](cycle-size.md)).
- **Merged** → the watcher dispatches post-merge cleanup for `<slug>-design`. [`cleanup.md`](cleanup.md) records `Design: finalized — design PR <url> merged <ISO-8601 timestamp>` in the build slot and resumes the build at Stage 3.
- **Closed unmerged** → cleanup records `Design: rejected — design PR <url> closed unmerged <ISO-8601 timestamp>`; no build runs.

Merging is a decision only the user may make: `frontloadQuestions=always` never defaults it, and a run told to go unattended still stops here.

## Waiting for the merge

After step 6 the forward cycle ends its turn with `echo "MUGGLE_STAGE_SKIP: design PR awaiting merge"`. Stages 3–8 run on the resume the merge dispatches, from a branch cut after the design landed.

## Output

The build slot's `state.md` carries a `Design: finalized` or `Design: pending` line, then this stage's marker in `iterations/<NNN>.md`: `Stage 2.5 done — <path taken> — <design PR url, spec link, pre-flight answer, or trivial reason>`.
