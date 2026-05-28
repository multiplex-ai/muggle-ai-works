# Stage 0 — reuse saved plan (or fall through)

A previously saved **prepare plan** is the durable recipe for this stack. Distinct from the ephemeral `/tmp/muggle-test-prepare.json` tracker — that file holds live PIDs/logs and is rebuilt every run.

## Resolve

In order; first hit wins.

1. **Project plan.** If `git rev-parse --show-toplevel` succeeds (call the result `$REPO`) and `$REPO/.muggle-ai/prepare-plan.json` exists → load it.
2. **Global plan.** Else if `~/.muggle-ai/prepare-plans.json` exists, read the entry keyed by `$(dirname "$PWD")` (absolute path). If present → load that entry's value.
3. **No plan found** → exit this step; the workflow continues at [rebase-check](./rebase-check.md).

A loaded plan is a JSON object with `version`, `updated`, `testing_scope`, `excluded_services`, `services`. Reject and treat as "no plan" if `version != 1` or `services` is empty.

## Gate `reusePreparePlan`

Per [`muggle-preferences/preference-gates/README.md`](../../muggle-preferences/preference-gates/README.md). Read the current value from the `Muggle Test Preferences` session-context line; absent → `ask`.

- `always` → silently take the **reuse path** (below). Print the silent footer.
- `never` → take the **rediscover path**: exit this step; continue at [rebase-check](./rebase-check.md).
- `ask` → print the loaded plan as a table:

  ```
  Service              Directory                          Command          Port
  ──────────────────────────────────────────────────────────────────────────────
  backend-api          ~/Github/backend-api               npm run dev      3001
  …
  ──────────────────────────────────────────────────────────────────────────────
  ```

  Run Picker 1 from the gate file (substitute `{services}`). Then Picker 2 ("Remember this choice?") per the shared template. Branch by Picker 1.

## Reuse path

1. **Validate per service entry.** For each `{name, dir, command, port}`:
   - `dir` exists → keep. Else drop the entry and log `"Dropped <name>: directory <dir> no longer exists"`.
   - The indicator file that produced `command` still exists in `dir` (e.g. `package.json` for an `npm`/`node` command; see the indicator table in [start-commands](./start-commands.md)) → keep. Else re-derive **just that one entry** by running the indicator-detection from [start-commands](./start-commands.md) against `dir`, and replace its `command`. Log `"Re-derived <name>: <old> → <new>"`.
2. **All entries dropped** → discard the plan; continue at [rebase-check](./rebase-check.md). Otherwise proceed with surviving + re-derived entries.
3. **Hydrate** `/tmp/muggle-test-prepare.json` with the surviving entries (no PIDs yet, `testing_scope` from the plan, `excluded_services` from the plan).
4. **Short-circuit** to [check-running](./check-running.md). The skipped stages are [scope](./scope.md), [viability-check](./viability-check.md), [identify-services](./identify-services.md), [start-commands](./start-commands.md) — the reused plan supplies their answers. The remaining stages run normally: [env-file](./env-file.md), [fresh-install](./fresh-install.md), [start-services](./start-services.md) (only for entries not already listening), [smoke-test](./smoke-test.md), [readiness-report](./readiness-report.md).

## Rediscover path

Continue at [rebase-check](./rebase-check.md). The full normal flow runs.
