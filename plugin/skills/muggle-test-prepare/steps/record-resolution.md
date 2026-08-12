# Recording a resolution

How a problem hit during preparation becomes something the next run already knows. Referenced by [start-services](./start-services.md), [smoke-test](./smoke-test.md), and [fresh-install](./fresh-install.md) — every stage that can fail.

## On a replay: consult before attempting

When a step fails and the recipe holds a resolution for the same signal, apply that resolution first. A problem solved before is solved the same way again, silently. Re-deriving a fix the user already sat through is the failure this whole mechanism exists to prevent.

Only when no recorded resolution matches, or the recorded one does not clear it, does the failure become a [hard block](./confirm-recipe.md#hard-block).

## Resolving

1. **Attempt autonomously** where the fix is known and safe — a clean restart, a fresh install, waiting out a slow boot that is still making progress.
2. **Escalate** when it is not. During execution that means returning `needs-input:` naming the service and the concrete signal; the dispatching skill resolves it with the user and re-dispatches. Never guess at a fix that could destroy state.

## What to record

Per resolved problem, three things and nothing else:

- The **signal** — the concrete observation, not a paraphrase. An HTTP status, a matched log line, an exit code.
- The **service** it occurred on.
- The **resolution** that actually cleared it, and whether it was autonomous or user-directed.

A problem that was never cleared is not a resolution. Record it as an exclusion with its reason instead, so the next run does not retry something known to be hopeless.

## What not to record

- A transient that cleared on retry with no intervention. Nothing was learned; it was a blip.
- A signal already recorded for the same service with the same resolution. Update the existing entry rather than appending a duplicate.
- Anything containing a credential. Record the pointer form per [e2e-instructions](./e2e-instructions.md#secrets).

Resolutions accumulate through the run and are written **only** when the user accepts the gate in [confirm-recipe](./confirm-recipe.md). Nothing is persisted mid-run.
