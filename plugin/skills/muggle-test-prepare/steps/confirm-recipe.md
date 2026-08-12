# Final stage — Confirm the recipe

The one gate of a learning run. Everything the run discovered is held until here, so the user makes a single decision instead of approving facts one at a time.

Runs after the environment is verified ready — a recipe for a preparation that did not work is worth nothing.

## Show what was done

Summarise the actual run, not the plan that preceded it:

```
Prepared your environment. Here's what it took:

  Services started, in order
    1. api        pnpm --filter api dev        :8080
    2. worker     pnpm --filter worker dev     —
    3. ui         pnpm dev                     :3999

  Manual steps
    • pnpm db:migrate — run once before the api comes up

  Problems hit, and what fixed them
    • ui — HTTP 500 on /dashboard while api was still booting
      → started api first and waited for its ready signal
    • worker — exited immediately, missing .env.local
      → copied .env.example, you filled in QUEUE_URL

  Not running locally
    • payment-gateway — needs production certificates

Remember this as your prepare recipe, so future runs just do it?
```

`AskUserQuestion`:

- `Remember it` — `Future E2E runs prepare this way without asking.`
- `Don't remember` — `Prepare from scratch again next time.`

## On accept

Write both halves of the recipe together, so they cannot drift:

- The machine-readable service graph to `~/.muggle-ai/prepare-plans.json`, keyed on the stack, per [readiness-report](./readiness-report.md).
- The prose — startup order, manual steps, gotchas, and the recorded resolutions from [record-resolution](./record-resolution.md) — to `~/.muggle-ai/e2e-instructions/<key>.md`, per [e2e-instructions](./e2e-instructions.md).

## On decline

Write nothing. The next run learns again. Do not ask a second time in the same run, and do not record the refusal as a preference — the user is declining this recipe, not the idea of recipes.

## Hard block

The only thing that lets a replay deviate: **a failure the recipe's recorded resolutions do not cover, which autonomous attempts cannot clear.**

Anything the recipe already handles is not a hard block, however loudly it fails. Neither is a transient that clears on retry. The bar is deliberately high, because every re-prompt undoes the learning.

On a hard block: resolve it with the user, then offer to update the recipe with the new resolution — the same accept/decline, scoped to the one addition. Otherwise the recipe changes only when the user asks for it.
