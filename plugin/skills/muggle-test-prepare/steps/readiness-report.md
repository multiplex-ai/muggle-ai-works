# Final readiness report

Only after every service passes [smoke-test](./smoke-test.md) or is skipped.

```
Service              PID      Port     Status         Smoke Test
─────────────────────────────────────────────────────────────────
backend-api          12345    3001     Running        ✓
auth-service         12346    8080     Running        ✓
frontend             12347    3000     Running        ✓
─────────────────────────────────────────────────────────────────
All services verified. Ready for E2E.
```

Surface skipped services so the caller knows the gap:

```
Skipped: payment-gateway — HTTP 500 on /
```

If you launched the services:

```
Logs: /tmp/muggle-prepare-*.log
Cleanup: say "stop services" or re-invoke this skill.
```

## Save the plan

Only on a learning run, and only once the user has accepted the gate in [confirm-recipe](./confirm-recipe.md). Nothing is persisted before that — a recipe the user didn't agree to is a recipe they'll have to undo, and a recipe for a preparation that failed is worse than none.

A replay run writes nothing here; it already has the recipe.

Build the JSON from the in-memory tracking file, dropping runtime fields:

```bash
jq '{
  version: 1,
  updated: now | todate,
  testing_scope: .testing_scope,
  excluded_services: .excluded_services,
  services: [.services[] | {name, dir, command, port}]
}' /tmp/muggle-test-prepare.json
```

Upsert it under the stack's key — the absolute path of the working directory's parent — in `~/.muggle-ai/prepare-plans.json`, creating the file as `{}` if missing. The plan is machine-local, user-level data: it never goes inside the user's project, and resolving it requires no version-control tool.

Then print, once:

```
✓ Saved this stack as your prepare plan — next run can skip the questions.
  (Disable with `/muggle-preferences reusePreparePlan`.)
```

If this run short-circuited via [reuse-plan](./reuse-plan.md), don't rewrite — but **do** refresh `updated` and any `command` that was re-derived during validation. Skip the announcement on the refresh path.

## Save the E2E run instructions

The instructions arrive resolved in the dispatch prompt — captured while the user was present, in [e2e-instructions](./e2e-instructions.md). Write them verbatim, in that stage's format, to the location it resolves: `~/.muggle-ai/e2e-instructions/<key>.md`. Create the directory if missing. This file is machine-local and never goes inside the user's project.

Nothing resolved in the plan → write nothing. An absent file is a stage that has not run yet; an empty one would read as "nothing to say" and suppress the question forever.

Never write a credential value here — pointers only, per that stage's Secrets rule.
