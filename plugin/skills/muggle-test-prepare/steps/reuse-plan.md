# Resolving the saved plan

How [replay-or-learn](./replay-or-learn.md) finds the machine-readable half of the recipe. A previously saved **prepare plan** is the durable recipe for this stack, paired with the prose half in `~/.muggle-ai/e2e-instructions/<key>.md`. Distinct from the ephemeral per-checkout tracking files ([PID Tracking](../SKILL.md#pid-tracking)) — those hold live PIDs and logs.

Finding a plan means this is a **replay run**: execute it, ask nothing. Finding none means a **learning run**.

## Resolve

In order; first hit wins.

1. **Saved plan.** If `~/.muggle-ai/prepare-plans.json` exists, read the entry keyed on this stack. If present → load that entry's value. The plan is machine-local and is never read from, or written to, the user's project.

   **Stack key** — the absolute main working-tree root of the repo containing the working directory (the first `worktree` line of `git worktree list --porcelain`), so every worktree of one clone shares one recipe; outside any repo, the working directory's parent. No entry under the key → adopt an older entry whose services name this repo (by main root or by a path inside one of its worktrees) and re-key it on the next write.
2. **No plan found** → exit this step; the workflow continues at [rebase-check](./rebase-check.md).

A loaded plan is a JSON object with `version`, `updated`, `testing_scope`, `excluded_services`, `services`. Reject and treat as "no plan" if `version != 1` or `services` is empty.

Load the prose companion per [e2e-instructions](./e2e-instructions.md) — `~/.muggle-ai/e2e-instructions/<key>.md`, keyed on the same stack identity as the global plan entry. It is independent of the plan: a missing companion is not a missing plan, and vice versa.

## Gate `reusePreparePlan`

Per [`muggle-preferences/preference-gates/README.md`](../../muggle-preferences/preference-gates/README.md). Read the current value from the `Muggle Test Preferences` session-context line, which carries every key already resolved.

- `always` → silently take the **reuse path** (below). Print the silent footer (substitute `{services}` with the comma-separated names from the loaded plan).
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

1. **Validate per service entry.** Normalize legacy entries per [resolve-sources](./resolve-sources.md#legacy-plan-entries) first. For each `{name, dir, command, port}`:
   - `dir` exists → keep. Else drop the entry and log `"Dropped <name>: directory <dir> no longer exists"`.
   - The indicator file that produced `command` still exists in `dir` (e.g. `package.json` for an `npm`/`node` command; see the indicator table in [start-commands](./start-commands.md)) → keep. Else re-derive **just that one entry** by running the indicator-detection from [start-commands](./start-commands.md) against `dir`, and replace its `command`. Log `"Re-derived <name>: <old> → <new>"`.
2. **All entries dropped** → discard the plan; continue at [rebase-check](./rebase-check.md). Otherwise proceed with surviving + re-derived entries.
3. **Hydrate** the resolved plan with the surviving entries (`testing_scope` and `excluded_services` from the plan).
4. **Short-circuit** through [rebase-check](./rebase-check.md) and [resolve-sources](./resolve-sources.md) to [check-running](./check-running.md). The skipped stages are [scope](./scope.md), [viability-check](./viability-check.md), [identify-services](./identify-services.md), [start-commands](./start-commands.md), [e2e-instructions](./e2e-instructions.md) — the reused plan and its companion supply their answers. Carry the loaded instructions forward unchanged; the user is not re-asked. When the companion is absent, run [e2e-instructions](./e2e-instructions.md) once to capture it, then continue the short-circuit. The remaining stages run normally: [env-file](./env-file.md), [fresh-install](./fresh-install.md), [start-services](./start-services.md) (only for entries not already listening), [smoke-test](./smoke-test.md), [readiness-report](./readiness-report.md).

## Rediscover path

Continue at [rebase-check](./rebase-check.md). The full normal flow runs.
