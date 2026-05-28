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

If this run came through discovery (i.e. Stage 0 [reuse-plan](./reuse-plan.md) did **not** short-circuit), persist the plan so the next run can skip the questions.

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

Resolve the write location:

- If `git rev-parse --show-toplevel` succeeds (call the result `$REPO`) → write `$REPO/.muggle-ai/prepare-plan.json`. Create `$REPO/.muggle-ai/` if missing.
- Else → upsert the entry under key `$(dirname "$PWD")` (absolute) in `~/.muggle-ai/prepare-plans.json`. Create the file as `{}` if missing.

Then print, once:

```
✓ Saved this stack as your prepare plan — next run can skip the questions.
  (Disable with `/muggle-preferences reusePreparePlan`.)
```

If this run short-circuited via [reuse-plan](./reuse-plan.md), don't rewrite — but **do** refresh `updated` and any `command`/`port` that changed during validation. Skip the announcement on the refresh path.
