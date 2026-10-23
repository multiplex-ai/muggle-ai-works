# Final readiness report

Only after every service passes [smoke-test](./smoke-test.md) or is skipped.

```
Service       PID     Port   Source                                      Commit              Smoke Test
──────────────────────────────────────────────────────────────────────────────────────────────────────
backend-api   12345   3001   ~/Github/api/.claude/worktrees/base-main    a1b2c3d             ✓
auth-service  12346   8080   ~/Github/auth/.claude/worktrees/base-main   4d5e6f7 (2 behind)  ✓
frontend      12347   3000   ~/Github/app/.claude/worktrees/feat-x       9f8e7d6             ✓
──────────────────────────────────────────────────────────────────────────────────────────────────────
All services verified. Ready for E2E.
```

`Source` is the run directory's checkout and `Commit` the HEAD it serves — what the caller checks to confirm its own change is the code under test. A base checkout that could not be refreshed this run (a peer's run held the lock) shows how far it trails `origin/<default>`.

Surface skipped services so the caller knows the gap:

```
Skipped: payment-gateway — HTTP 500 on /
```

If you launched the services:

```
Logs: ~/.muggle-ai/prepare/logs/<source-key>/
Cleanup: say "stop services" or re-invoke this skill.
```

## Save the plan

Only on a learning run, and only once the user has accepted the gate in [confirm-recipe](./confirm-recipe.md). Nothing is persisted before that — a recipe the user didn't agree to is a recipe they'll have to undo, and a recipe for a preparation that failed is worse than none.

A replay run writes nothing here; it already has the recipe.

Build the JSON from the resolved plan, keeping only the durable fields:

```json
{
  "version": 1,
  "updated": "<now, ISO-8601>",
  "testing_scope": "<testingScope>",
  "excluded_services": [{ "name": "…", "reason": "…" }],
  "services": [{ "name": "…", "dir": "…", "command": "…", "port": 3000 }]
}
```

Each service's `dir` names its **repo**, never a checkout: the repo's main working-tree root plus the service's sub-directory — never a linked worktree or base-checkout path, which is a per-run choice [resolve-sources](./resolve-sources.md) makes again every time.

Upsert it under the stack key ([reuse-plan](./reuse-plan.md)) in `~/.muggle-ai/prepare-plans.json`, creating the file as `{}` if missing. The plan is machine-local, user-level data: it never goes inside the user's project.

Then print, once:

```
✓ Saved this stack as your prepare plan — next run can skip the questions.
  (Disable with `/muggle-preferences reusePreparePlan`.)
```

If this run short-circuited via [reuse-plan](./reuse-plan.md), don't rewrite — but **do** refresh `updated`, any `command` re-derived during validation, any legacy `dir` normalized by [resolve-sources](./resolve-sources.md#legacy-plan-entries), and an adopted entry's key. Skip the announcement on the refresh path.

## Save the E2E run instructions

The instructions arrive resolved in the dispatch prompt — captured while the user was present, in [e2e-instructions](./e2e-instructions.md). Write them verbatim, in that stage's format, to the location it resolves: `~/.muggle-ai/e2e-instructions/<key>.md`. Create the directory if missing. This file is machine-local and never goes inside the user's project.

Nothing resolved in the plan → write nothing. An absent file is a stage that has not run yet; an empty one would read as "nothing to say" and suppress the question forever.

Never write a credential value here — pointers only, per that stage's Secrets rule.
