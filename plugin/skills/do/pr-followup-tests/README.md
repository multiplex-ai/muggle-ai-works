# Stage 8 mock fixtures

Test fixtures for the per-tick contract in [`../pr-followup.md`](../pr-followup.md). Each fixture is a single self-contained scenario: mock `gh` responses, mock session state on disk, and the expected outcome.

These are **review fixtures**, not a runnable unit-test suite. The classification rule lives in prose ([`../pr-followup-helpers.md`](../pr-followup-helpers.md)) and is executed by the model at runtime, not by deterministic code. A future PR may add a TypeScript runner that uses these fixtures as eval inputs.

## Fixture shape

```jsonc
{
  "name": "<slug>",
  "description": "<one-line plain-English scenario>",

  "input": {
    "session_slug": "<slug used in .muggle-do/sessions/>",
    "prs_json":      [ /* contents of prs.json before the tick */ ],
    "last_seen_json": { /* contents of last_seen.json before the tick */ },
    "gh_responses": {
      // map of mock command → mock JSON response. Keys match the
      // commands pr-followup.md issues. Unspecified commands are
      // assumed to return empty.
      "gh pr view <n> --repo <r> --json state,mergedAt,closedAt,headRefOid": {...},
      "gh api repos/<r>/pulls/<n>/comments": [...],
      "gh api repos/<r>/pulls/<n>/reviews": [...],
      "gh pr checks <n> --repo <r>": [...]
    }
  },

  "expected": {
    "preamble":            "<turn preamble line>",
    "items_seen":          <int>,
    "items_picked":        [ /* one entry per PR that had an actionable item */ ],
    "telemetry_events":    [ /* one entry per item + one tick-summary entry */ ],
    "state_writes":        { /* paths and a sentence about what was written */ },
    "loop_continues":      true | false
  }
}
```

`items_picked[]` entries describe the routing outcome for the one item picked per PR:

```jsonc
{
  "pr_key":           "<owner>/<repo>#<n>",
  "type":             "line_comment" | "review_body" | "ci_failure" | "issue_comment",
  "classification":   "directive" | "question" | "ambiguous" | "ci",
  "outcome":          "fixed_and_pushed" | "replied" | "escalated" | "skipped",
  "reply_endpoint":   "<path the reply would hit>" | null,
  "reply_body_contains": [ /* substring assertions */ ],
  "commit_subject":   "<commit subject if pushed>" | null
}
```

## The fixtures

| # | File | What it exercises |
| :- | :--- | :---------------- |
| 1 | [`01-line-comment-directive.json`](01-line-comment-directive.json) | Happy path: line-level directive → fix, push, reply. |
| 2 | [`02-question.json`](02-question.json) | Question → reply only, no code change, no push. |
| 3 | [`03-ambiguous.json`](03-ambiguous.json) | Ambiguous comment → escalate, pause this PR, terminal message to user. |
| 4 | [`04-failing-ci.json`](04-failing-ci.json) | Failing CI check → read job log, fix, push. No reply. |
| 5 | [`05-mixed.json`](05-mixed.json) | Three new items on one PR. Loop picks the oldest; the rest wait for the next tick. |
| 6 | [`06-all-merged.json`](06-all-merged.json) | Every PR in the manifest is merged. Write `result.md`, do NOT schedule the next tick. |
| 7 | [`07-in-flight-push.json`](07-in-flight-push.json) | A failing check whose `head_sha` equals `last_pushed_sha` — skipped by the guard (decision 11). |

## How to use these

When reading or modifying `pr-followup.md` / `pr-followup-helpers.md`:

1. Walk each fixture's `input` through the per-tick contract.
2. Confirm you would arrive at the documented `expected` outcome.
3. If you can't, either the docs are wrong or the fixture is wrong — fix the one that's actually wrong.

When adding new behavior to stage 8: add a fixture before changing the docs. The fixture is the spec.
