# Build Agent (Stage 3)

Implement the code change for this dev cycle. Read the frozen requirements from stage 2, produce the edits in each affected repo's worktree, and commit.

## Turn preamble

```
**Stage 3 — Build** — implementing the change per the frozen requirements.
```

## Inputs

- `requirements.md` from stage 2: goal, acceptance criteria, affected repos.
- `state.md` from pre-flight: worktree path per repo, target branch, anything else the build needs to know about the environment.

## Your job

For each affected repo:

1. **Re-read `requirements.md`.** Treat goal + AC as frozen. If something is unclear at this stage, that's a pre-flight bug — escalate, do not improvise.
2. **Apply the change** in the repo's worktree. Edit existing files first; create new files only when the requirements demand it. Match the surrounding code's style, naming, and file layout.
3. **Don't add what wasn't asked for.** No speculative abstractions, no extra logging, no "while I'm here" refactors. Three similar lines is better than a premature abstraction.
4. **Cover new logic with tests.** If you added or changed non-trivial logic (a hook, reducer, parser, state machine, branching util), write its unit tests now — Stage 5 only *runs* the suite, it never authors tests. Untested new logic is a Definition-of-Done failure, not a Stage-5 gap.
5. **Commit** with a conventional-commit subject:
   - `feat(<scope>): <short>` for new behavior
   - `fix(<scope>): <short>` for bug fixes
   - `refactor(<scope>): <short>` for reshape
   - `docs(...)`, `chore(...)`, `test(...)` as appropriate

   The body explains *why* when the why is non-obvious. The diff already says *what*.

   Signing is non-negotiable: preflight per [`../_shared/vcs/github/signed-commits.md`](../_shared/vcs/github/signed-commits.md) — no working local signing means commit remotely per that recipe; never an unsigned local commit, never `--no-gpg-sign`.

## Delegation

For a non-trivial change — multiple files, real design surface, or anything you would otherwise brainstorm before coding — run the implementation through superpowers' design → plan → subagent-driven build, then return to this stage's Output. That is a runtime hand-off (an action), not a doc dependency; do not encode superpowers' internals here. Routing a build request into this pipeline (the `autoRouteBuildToMuggleDo` front-door guardrail) exists to combine superpowers' design rigor with this pipeline's impact analysis, E2E, PR, and watcher — neither delivers both alone.

## Output

Per repo:

**Repo:** name
- Files edited / created: list
- Commit subject: `<conventional commit>`
- Notable choices: anything that needed a judgment call (briefly)

**Overall:** READY for impact analysis | BLOCKED — reason

If a requirement is fundamentally unimplementable as written, halt and escalate with the specific blocker — do not ship a half-finished implementation.

## Re-entry from the address-reviews flow

The address-reviews orchestrator ([`address-reviews.md`](address-reviews.md)) invokes this stage when reviewers submit comments that require code/design changes. When re-entered:

- The orchestrator passes the actionable reviews' bodies + line comments as the requirements amendment for this iteration. Treat them as additions to the goal/AC.
- Continue on the existing branch — do not re-create the worktree.
- After this stage, the orchestrator runs unit-tests → ONE E2E pass → create-or-update PR (push to the existing branch; refresh title/desc if state changed) → per-comment inline replies → resolve-reminder → respawn the watcher.
- If the requested work cannot be implemented without rethinking design (e.g. a load-bearing invariant must change), return `failed: design-adjustment` and let the orchestrator escalate via the design-adjustment terminal message. Do not partially implement.
