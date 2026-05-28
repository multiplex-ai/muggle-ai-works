# Router eval report

- model: `default`  runs/query: 3
- overall accuracy (muggle-routing): **81/82 = 98.8%**
- negative-class rule: a query labeled `none` passes when no `muggle*` skill fires; an appropriate non-muggle skill (debugging, review, brainstorming) winning is correct.

## Per-skill recall (positive queries)

| skill | correct | total | recall | stolen by (majority when wrong) |
|---|---|---|---|---|
| muggle | 4 | 4 | 100% | — |
| muggle-do-task | 5 | 5 | 100% | — |
| muggle-feedback | 5 | 5 | 100% | — |
| muggle-pr-visual-walkthrough | 5 | 5 | 100% | — |
| muggle-preferences | 4 | 4 | 100% | — |
| muggle-repair | 4 | 4 | 100% | — |
| muggle-status | 4 | 4 | 100% | — |
| muggle-test | 6 | 7 | 86%  ⚠ | none×1 |
| muggle-test-feature-local | 6 | 6 | 100% | — |
| muggle-test-import | 6 | 6 | 100% | — |
| muggle-test-prepare | 5 | 5 | 100% | — |
| muggle-test-regenerate-missing | 5 | 5 | 100% | — |
| muggle-upgrade | 3 | 3 | 100% | — |
| muggle-works-npm-release | 4 | 4 | 100% | — |

## Negative class (must not fire a muggle skill)

- 15/15 clean (no muggle skill fired).
- No muggle skill over-triggered on any near-miss. ✔

## Genuine misses

- expected `muggle-test` got `none` — did my latest commits break any user flows?  (fired: {'none': 3})
