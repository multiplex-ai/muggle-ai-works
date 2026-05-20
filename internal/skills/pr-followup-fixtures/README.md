# pr-followup fixtures

Prose-eval fixtures (not runnable unit tests) for the watcher-handoff shape of stage-8 review follow-ups. Each fixture is a self-contained scenario: mock inputs + expected outcome.

Three folders, one per code path:

- [`watcher/`](watcher/) — the dumb-pipe watcher's per-tick contract. Procedure: [`../../../plugin/skills/muggle-pr-followup/contract.md`](../../../plugin/skills/muggle-pr-followup/contract.md). The watcher's only job is to poll for new submitted reviews and dispatch `/muggle-do` if there are any; these fixtures verify exactly that.
- [`bootstrap/`](bootstrap/) — the bootstrap-from-URL entry point. Procedure: [`../../../plugin/skills/muggle-pr-followup/bootstrap.md`](../../../plugin/skills/muggle-pr-followup/bootstrap.md). Non-interactive setup + first watcher dispatch.
- [`address-reviews/`](address-reviews/) — `/muggle-do`'s address-reviews flow. Procedure: [`../../../plugin/skills/do/address-reviews.md`](../../../plugin/skills/do/address-reviews.md). Classification, work execution, per-comment replies, resolve-reminder, respawn.

## Fixture shape

The shape is consistent across folders, with folder-specific field names:

```jsonc
{
  "name":        "<slug>",
  "description": "<one-line scenario>",

  "input": {
    "session_slug": "<slug>",
    "prs_json":      [ /* contents of prs.json before */ ],
    "last_seen_json": { /* contents of last_seen.json before */ },
    "args":          "<verbatim $ARGUMENTS for this entry point>",
    "gh_responses":  { /* map of mock command → mock response */ }
  },

  "expected": {
    "preamble":         "<expected turn preamble>",
    "outcome":          "<terse outcome label>",
    "state_writes":     { /* paths and what got written */ },
    "telemetry_events": [ /* events emitted, in order */ ],
    "side_effects":     [ /* gh / git commands the procedure should issue */ ],
    "respawned":        true | false
  }
}
```

The `args` field is the verbatim `$ARGUMENTS` the entry point sees — bootstrap uses a URL; watcher uses `<slug> <pr-number>`; address-reviews uses the directive text.

## How to use these

When reading or modifying a procedure file (`contract.md`, `bootstrap.md`, `address-reviews.md`):

1. Walk each fixture's `input` through the procedure mentally.
2. Confirm you would arrive at the documented `expected` outcome.
3. If you can't, either the procedure is wrong or the fixture is wrong — fix the one that's actually wrong.

When adding a new behavior: add a fixture before you change the procedure. The fixture is the spec.

## What's NOT covered yet

This set is a representative sample, not exhaustive. Known gaps (file as follow-up fixtures when the scenario actually happens):

- Watcher cursor advancement after a review is added to `escalated_review_ids` (currently covered indirectly by the dispatch fixture).
- Address-reviews when `build.md` returns `failed: design-adjustment` (the design-adjustment escalation path).
- Address-reviews with multiple actionable reviews from different reviewers in the same batch.
- Bootstrap with `--slug=<custom>` override.
- Resolve-reminder with zero addressed-by-loop threads (telemetry only, no comment).
